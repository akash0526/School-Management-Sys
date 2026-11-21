import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Cog, Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, Tabs } from '../../components/ui'
import { cx, enumOptions, useToast } from '../../components/ui-utils'
import { ApiError, get, post, put, type Items } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { date, gpa, pct, titleCase } from '../../lib/format'
import { sectionLabel, useClassSubjects, useClasses, useSections } from '../../lib/hooks'
import type { Assignment, Exam, Marksheet, ResultRow, Schedule } from '../../lib/types'

type Tab = 'papers' | 'marks' | 'results'

export function ExamDetailPage() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  // GET /exams/:id is a minimal record; the year's list has the full row (type, dates, year name)
  const exam = useQuery({
    queryKey: ['exam', id],
    queryFn: async () => {
      const base = await get<Pick<Exam, 'id' | 'academicYearId' | 'name' | 'isPublished'>>(`/exams/${id}`)
      const list = await get<Items<Exam>>('/exams', { academicYearId: base.academicYearId })
      return { ...(list.items.find((x) => x.id === id) ?? {}), ...base } as Exam
    },
  })
  const schedules = useQuery({ queryKey: ['schedules', id], queryFn: () => get<Items<Schedule>>(`/exams/${id}/schedules`) })
  const canMarks = can('marks.enter', 'marks.enter_any')
  const canResults = can('results.view', 'results.process', 'results.publish', 'marks.approve')
  const [tab, setTab] = useState<Tab>(canMarks && !can('exams.manage') ? 'marks' : 'papers')

  if (exam.isLoading) return <Spinner />
  if (!exam.data) return <ErrorBox error={exam.error ?? 'Exam not found'} />
  const e = exam.data

  return (
    <>
      <PageHeader
        back={<Link to="/exams" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="size-4" /> Exams</Link>}
        title={<span className="flex items-center gap-2">{e.name} {e.isPublished ? <Badge tone="green">Published</Badge> : <Badge>Not published</Badge>}</span>}
        subtitle={`${e.examType ? titleCase(e.examType) : 'Exam'} · Year ${e.academicYear ?? ''}${e.startDate ? ` · ${date(e.startDate)}${e.endDate ? ` – ${date(e.endDate)}` : ''}` : ''}`}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'papers', label: `Papers (${schedules.data?.items.length ?? 0})` },
          ...(canMarks || can('marks.approve') ? [{ id: 'marks' as Tab, label: 'Marks entry' }] : []),
          ...(canResults ? [{ id: 'results' as Tab, label: 'Results' }] : []),
        ]}
      />
      {tab === 'papers' && <PapersTab exam={e} schedules={schedules.data?.items ?? []} loading={schedules.isLoading} />}
      {tab === 'marks' && <MarksTab exam={e} schedules={schedules.data?.items ?? []} />}
      {tab === 'results' && <ResultsTab exam={e} schedules={schedules.data?.items ?? []} />}
    </>
  )
}

/* ───────────── Papers ───────────── */
function PapersTab({ exam, schedules, loading }: { exam: Exam; schedules: Schedule[]; loading: boolean }) {
  const { can } = useAuth()
  const classes = useClasses()
  const [classFilter, setClassFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const list = schedules.filter((s) => !classFilter || s.classId === Number(classFilter))
  const classIds = [...new Set(schedules.map((s) => s.classId))]
  return (
    <Card padded={false} title="Exam papers" actions={
      <>
        {classIds.length > 1 && <Select className="w-40 py-1.5" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} placeholder="All classes" options={(classes.data ?? []).filter((c) => classIds.includes(c.id)).map((c) => ({ value: c.id, label: c.name }))} />}
        {can('exams.manage') && !exam.isPublished && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add paper</Button>}
      </>
    }>
      {loading ? <Spinner /> : !list.length ? <Empty title="No papers scheduled" hint="Add a paper for each class subject, with theory / practical / internal components." /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Class</th><th>Subject</th><th>Date</th><th>Time</th><th>Components (full / pass)</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>{s.className}</td>
                  <td className="font-medium">{s.subjectName}</td>
                  <td>{date(s.examDate)}</td>
                  <td>{s.startTime ? `${s.startTime.slice(0, 5)}${s.endTime ? `–${s.endTime.slice(0, 5)}` : ''}` : '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {s.components.map((c) => <Badge key={c.id} tone="blue">{c.name} {c.fullMarks}/{c.passMarks}{c.creditHours ? ` · ${c.creditHours}cr` : ''}</Badge>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddPaperModal exam={exam} onClose={() => setAdding(false)} />}
    </Card>
  )
}

const COMPONENT_TYPES = ['theory', 'practical', 'internal', 'project', 'oral', 'cas'] as const
interface CompDraft { name: string; componentType: string; fullMarks: string; passMarks: string; creditHours: string }
const PRESETS: Record<string, CompDraft[]> = {
  'Theory 75 + Internal 25': [
    { name: 'Theory', componentType: 'theory', fullMarks: '75', passMarks: '26.25', creditHours: '3' },
    { name: 'Internal', componentType: 'internal', fullMarks: '25', passMarks: '8.75', creditHours: '1' },
  ],
  'Theory 100': [{ name: 'Theory', componentType: 'theory', fullMarks: '100', passMarks: '35', creditHours: '' }],
  'Theory 50 + Practical 50': [
    { name: 'Theory', componentType: 'theory', fullMarks: '50', passMarks: '17.5', creditHours: '2' },
    { name: 'Practical', componentType: 'practical', fullMarks: '50', passMarks: '20', creditHours: '2' },
  ],
}

function AddPaperModal({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const classes = useClasses()
  const [classId, setClassId] = useState('')
  const cs = useClassSubjects(exam.academicYearId, classId ? Number(classId) : undefined)
  const [f, setF] = useState({ classSubjectId: '', examDate: '', startTime: '', endTime: '' })
  const [comps, setComps] = useState<CompDraft[]>(PRESETS['Theory 75 + Internal 25']!)
  const setComp = (i: number, p: Partial<CompDraft>) => setComps((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const m = useMutation({
    mutationFn: () =>
      post(`/exams/${exam.id}/schedules`, {
        classSubjectId: Number(f.classSubjectId),
        examDate: f.examDate || null,
        startTime: f.startTime || null,
        endTime: f.endTime || null,
        components: comps.map((c, i) => ({ name: c.name, componentType: c.componentType, fullMarks: Number(c.fullMarks), passMarks: Number(c.passMarks), creditHours: c.creditHours ? Number(c.creditHours) : null, sequence: i + 1 })),
      }),
    onSuccess: () => { toast.success('Paper added'); void qc.invalidateQueries({ queryKey: ['schedules', exam.id] }); onClose() },
  })
  return (
    <Modal open onClose={onClose} size="lg" title="Add exam paper" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!f.classSubjectId || !comps.length} onClick={() => m.mutate()}>Add paper</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class"><Select value={classId} onChange={(e) => { setClassId(e.target.value); setF({ ...f, classSubjectId: '' }) }} placeholder="Select" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Subject"><Select value={f.classSubjectId} disabled={!classId} onChange={(e) => setF({ ...f, classSubjectId: e.target.value })} placeholder="Select" options={(cs.data ?? []).map((c) => ({ value: c.id, label: `${c.subjectName}${c.streamName ? ` (${c.streamName})` : ''}` }))} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><Input type="date" value={f.examDate} onChange={(e) => setF({ ...f, examDate: e.target.value })} /></Field>
          <Field label="Start"><Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
          <Field label="End"><Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="label mb-0">Components</span>
            <div className="flex flex-wrap gap-1">
              {Object.keys(PRESETS).map((p) => <button key={p} type="button" onClick={() => setComps(PRESETS[p]!)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">{p}</button>)}
            </div>
          </div>
          <div className="space-y-2">
            {comps.map((c, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Input className="col-span-3" value={c.name} onChange={(e) => setComp(i, { name: e.target.value })} placeholder="Name" maxLength={30} />
                <Select className="col-span-3" value={c.componentType} onChange={(e) => setComp(i, { componentType: e.target.value })} options={enumOptions(COMPONENT_TYPES)} />
                <Input className="col-span-2" type="number" step="0.01" value={c.fullMarks} onChange={(e) => setComp(i, { fullMarks: e.target.value, passMarks: e.target.value ? String(+(Number(e.target.value) * (c.componentType === 'practical' ? 0.4 : 0.35)).toFixed(2)) : c.passMarks })} placeholder="Full" title="Full marks" />
                <Input className="col-span-2" type="number" step="0.01" value={c.passMarks} onChange={(e) => setComp(i, { passMarks: e.target.value })} placeholder="Pass" title="Pass marks" />
                <Input className="col-span-1 px-2" type="number" step="0.5" value={c.creditHours} onChange={(e) => setComp(i, { creditHours: e.target.value })} placeholder="Cr" title="Credit hours" />
                <button type="button" className="col-span-1 justify-self-center text-slate-400 hover:text-rose-600" onClick={() => setComps((x) => x.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
          {comps.length < 6 && <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setComps((c) => [...c, { name: '', componentType: 'practical', fullMarks: '', passMarks: '', creditHours: '' }])}>Add component</Button>}
          <p className="mt-2 text-xs text-slate-500">NEB: each component is graded separately; below pass marks (35% theory) is NG. Credit hours drive the GPA.</p>
        </div>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}

/* ───────────── Marks entry ───────────── */
interface Entry { enrollmentId: number; rollNo: number | null; studentName: string; marks: string; isAbsent: boolean; remarks: string; verifiedAt: string | null }

function MarksTab({ exam, schedules }: { exam: Exam; schedules: Schedule[] }) {
  const { user, can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const any = can('marks.enter_any', 'marks.approve', 'results.view')
  const mine = useQuery({
    queryKey: ['my-assignments', user?.staffId, exam.academicYearId],
    queryFn: () => get<Items<Assignment>>('/academic/teacher-assignments', { staffId: user?.staffId ?? undefined, academicYearId: exam.academicYearId }),
    enabled: !any && !!user?.staffId,
  })
  const visibleSchedules = any ? schedules : schedules.filter((s) => mine.data?.items.some((a) => a.classSubjectId === s.classSubjectId))

  const [scheduleId, setScheduleId] = useState('')
  const schedule = schedules.find((s) => s.id === Number(scheduleId))
  const [componentId, setComponentId] = useState('')
  const [sectionId, setSectionId] = useState('')
  const sections = useSections(exam.academicYearId, schedule?.classId)
  const visibleSections = (sections.data ?? []).filter((s) => any || mine.data?.items.some((a) => a.classSubjectId === schedule?.classSubjectId && a.sectionId === s.id))
  useEffect(() => { setComponentId(schedule?.components.length === 1 ? String(schedule.components[0]!.id) : ''); setSectionId('') }, [scheduleId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sectionId && visibleSections.length === 1) setSectionId(String(visibleSections[0]!.id)) }, [visibleSections, sectionId])

  const sheet = useQuery({
    queryKey: ['marksheet', componentId, sectionId],
    queryFn: () => get<Marksheet>(`/exams/components/${componentId}/marks`, { sectionId }),
    enabled: !!componentId && !!sectionId,
  })
  const [rows, setRows] = useState<Entry[]>([])
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!sheet.data) return
    setRows(sheet.data.items.map((r) => ({ enrollmentId: r.enrollmentId, rollNo: r.rollNo, studentName: r.studentName, marks: r.marksObtained == null ? '' : String(r.marksObtained), isAbsent: r.isAbsent, remarks: r.remarks ?? '', verifiedAt: r.verifiedAt })))
    setDirty(false)
  }, [sheet.data])

  const full = sheet.data?.component.fullMarks ?? 0
  const locked = !!sheet.data?.component.examPublished || !can('marks.enter', 'marks.enter_any')
  const invalid = rows.filter((r) => !r.isAbsent && r.marks !== '' && (Number(r.marks) < 0 || Number(r.marks) > full || !/^\d+(\.\d{1,2})?$/.test(r.marks)))
  const entered = rows.filter((r) => r.isAbsent || r.marks !== '').length

  const save = useMutation({
    mutationFn: () => put(`/exams/components/${componentId}/marks`, {
      sectionId: Number(sectionId),
      entries: rows.filter((r) => r.isAbsent || r.marks !== '').map((r) => ({ enrollmentId: r.enrollmentId, marksObtained: r.isAbsent ? null : Number(r.marks), isAbsent: r.isAbsent, remarks: r.remarks || null })),
    }),
    onSuccess: () => { toast.success('Marks saved'); setDirty(false); void qc.invalidateQueries({ queryKey: ['marksheet', componentId, sectionId] }) },
    onError: toast.error,
  })
  const setRow = (i: number, p: Partial<Entry>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true) }

  return (
    <Card padded={false}>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
        <Field label="Paper"><Select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} placeholder={visibleSchedules.length ? 'Select paper' : 'No papers assigned to you'} options={visibleSchedules.map((s) => ({ value: s.id, label: `${s.className} · ${s.subjectName}` }))} /></Field>
        <Field label="Component"><Select value={componentId} disabled={!schedule} onChange={(e) => setComponentId(e.target.value)} placeholder="Select" options={(schedule?.components ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.fullMarks})` }))} /></Field>
        <Field label="Section"><Select value={sectionId} disabled={!schedule} onChange={(e) => setSectionId(e.target.value)} placeholder="Select" options={visibleSections.map((s) => ({ value: s.id, label: sectionLabel(s) }))} /></Field>
      </div>
      {!componentId || !sectionId ? <Empty title="Pick a paper, component and section" /> : sheet.isLoading ? <Spinner /> : sheet.error ? <ErrorBox error={sheet.error} className="m-4" /> : !rows.length ? <Empty title="No students" /> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>Full marks <b>{full}</b></span>·<span><b>{entered}</b>/{rows.length} entered</span>
              {rows.length > 0 && rows.every((r) => r.verifiedAt) && <Badge tone="green">Verified</Badge>}
              {locked && sheet.data?.component.examPublished && <Badge tone="amber">Locked — exam published</Badge>}
            </div>
            {!locked && <Button size="sm" icon={<Save className="size-4" />} loading={save.isPending} disabled={!dirty || invalid.length > 0 || entered === 0} onClick={() => save.mutate()}>Save marks</Button>}
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th className="w-16">Roll</th><th>Student</th><th className="w-36">Marks / {full}</th><th className="w-24">Absent</th><th>Remarks</th><th className="w-10"></th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const bad = invalid.includes(r)
                  return (
                    <tr key={r.enrollmentId}>
                      <td className="text-slate-500">{r.rollNo ?? '—'}</td>
                      <td className="font-medium text-slate-900">{r.studentName}</td>
                      <td>
                        <Input
                          inputMode="decimal"
                          className={cx('py-1.5 text-right tabular-nums', bad && 'border-rose-400 ring-2 ring-rose-100')}
                          value={r.isAbsent ? '' : r.marks}
                          disabled={locked || r.isAbsent}
                          placeholder={r.isAbsent ? 'ABS' : ''}
                          onChange={(e) => setRow(i, { marks: e.target.value.trim() })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); (document.querySelectorAll<HTMLInputElement>('input[inputmode=decimal]')[i + 1])?.focus() }
                            if (e.key === 'ArrowUp') { e.preventDefault(); (document.querySelectorAll<HTMLInputElement>('input[inputmode=decimal]')[i - 1])?.focus() }
                          }}
                        />
                      </td>
                      <td><input type="checkbox" className="size-4 accent-rose-600" checked={r.isAbsent} disabled={locked} onChange={(e) => setRow(i, { isAbsent: e.target.checked })} /></td>
                      <td><Input className="py-1.5" value={r.remarks} disabled={locked} onChange={(e) => setRow(i, { remarks: e.target.value })} maxLength={255} /></td>
                      <td>{r.verifiedAt && <CheckCircle2 className="size-4 text-emerald-500" aria-label="Verified" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {invalid.length > 0 && <div className="border-t border-slate-100 px-4 py-3"><Notice tone="amber">{invalid.length} value(s) are invalid. Marks must be between 0 and {full}, with up to 2 decimals.</Notice></div>}
          {!locked && <p className="px-4 py-3 text-xs text-slate-400">Tip: press Enter or ↓ to move to the next student. Editing marks clears their verification.</p>}
        </>
      )}
    </Card>
  )
}

/* ───────────── Results ───────────── */
function ResultsTab({ exam, schedules }: { exam: Exam; schedules: Schedule[] }) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const classIds = useMemo(() => [...new Set(schedules.map((s) => s.classId))], [schedules])
  const allSections = useSections(exam.academicYearId)
  const sections = (allSections.data ?? []).filter((s) => classIds.includes(s.classId))
  const [sectionId, setSectionId] = useState('')
  const [forcePrompt, setForcePrompt] = useState<string | null>(null)
  const results = useQuery({ queryKey: ['results', exam.id, sectionId], queryFn: () => get<Items<ResultRow>>(`/exams/${exam.id}/results`, { sectionId }), enabled: can('results.view') })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['results', exam.id] }); void qc.invalidateQueries({ queryKey: ['exam', exam.id] }); void qc.invalidateQueries({ queryKey: ['exams'] }); void qc.invalidateQueries({ queryKey: ['marksheet'] }) }

  const verify = useMutation({
    mutationFn: () => post<{ verified: number }>(`/exams/${exam.id}/verify`, { sectionId: Number(sectionId) }),
    onSuccess: (r) => { toast.success(`${r.verified} mark(s) verified`); refresh() },
    onError: toast.error,
  })
  const process = useMutation({
    mutationFn: (force: boolean) => post<{ processed: number; graded: number; notGraded: number; absent: number; treatedAsAbsent: number }>(`/exams/${exam.id}/process`, { sectionId: sectionId ? Number(sectionId) : null, force }),
    onSuccess: (r) => { setForcePrompt(null); toast.success(`Processed ${r.processed}: ${r.graded} graded, ${r.notGraded} NG, ${r.absent} absent`); refresh() },
    onError: (e) => { if (e instanceof ApiError && e.status === 400 && /force/.test(e.message)) setForcePrompt(e.message.replace(/, or re-run with force=true/, '')); else toast.error(e) },
  })
  const publish = useMutation({
    mutationFn: (published: boolean) => post(`/exams/${exam.id}/publish`, { published }),
    onSuccess: (_, p) => { toast.success(p ? 'Results published. Parents and students can now see them.' : 'Results unpublished'); refresh() },
    onError: toast.error,
  })

  const rows = results.data?.items ?? []
  const graded = rows.filter((r) => r.resultStatus === 'graded')
  const avgGpa = graded.length ? graded.reduce((a, r) => a + Number(r.gpa ?? 0), 0) / graded.length : null

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 p-4">
          <Field label="Section" className="min-w-60">
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="All sections" options={sections.map((s) => ({ value: s.id, label: sectionLabel(s) }))} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {can('marks.approve') && <Button variant="secondary" icon={<CheckCircle2 className="size-4" />} disabled={!sectionId || exam.isPublished} title={!sectionId ? 'Choose a section first' : undefined} loading={verify.isPending} onClick={() => verify.mutate()}>Verify marks</Button>}
            {can('results.process') && <Button variant="secondary" icon={<Cog className="size-4" />} disabled={exam.isPublished} loading={process.isPending} onClick={() => process.mutate(false)}>Process results</Button>}
            {can('results.publish') && (exam.isPublished
              ? <Button variant="secondary" icon={<EyeOff className="size-4" />} loading={publish.isPending} onClick={() => confirm('Unpublish? Parents and students will no longer see these results.') && publish.mutate(false)}>Unpublish</Button>
              : <Button variant="success" icon={<Eye className="size-4" />} loading={publish.isPending} disabled={!rows.length} onClick={() => confirm('Publish results to parents and students? Marks will be locked.') && publish.mutate(true)}>Publish</Button>)}
          </div>
        </div>
        {exam.isPublished && <div className="px-4 pb-4"><Notice tone="green">Published. Marks are locked; unpublish to make corrections and re-process.</Notice></div>}
      </Card>

      {rows.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-4">
          <MiniStat label="Students" value={rows.length} />
          <MiniStat label="Graded" value={graded.length} />
          <MiniStat label="Not graded / absent" value={rows.length - graded.length} />
          <MiniStat label="Average GPA" value={gpa(avgGpa)} />
        </div>
      )}

      <Card padded={false}>
        {results.isLoading ? <Spinner /> : !rows.length ? <Empty title="No results yet" hint="Enter marks, verify them, then click “Process results”." /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Rank</th><th>Student</th><th>Class</th><th className="text-right">Total</th><th className="text-right">%</th><th className="text-right">GPA</th><th>Grade</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.enrollmentId}>
                    <td className="font-semibold text-slate-500">{(sectionId ? r.rankInSection : r.rankInClass) ?? '—'}</td>
                    <td><div className="font-medium text-slate-900">{r.studentName}</div><div className="text-xs text-slate-500">Roll {r.rollNo ?? '—'} · {r.admissionNo}</div></td>
                    <td>{r.className} – {r.sectionName}</td>
                    <td className="text-right tabular-nums">{r.totalObtained ?? '—'}<span className="text-slate-400">/{r.totalFull ?? '—'}</span></td>
                    <td className="text-right tabular-nums">{pct(r.percentage)}</td>
                    <td className="text-right font-semibold tabular-nums">{gpa(r.gpa)}</td>
                    <td>{r.finalGrade ?? '—'}</td>
                    <td><StatusBadge status={r.resultStatus} /></td>
                    <td className="text-right"><Link className="text-sm font-medium text-brand-600 hover:text-brand-700" to={`/report-card/${exam.id}/${r.studentId}`}>Report card</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {forcePrompt && (
        <Modal open onClose={() => setForcePrompt(null)} title="Some marks are missing" size="sm" footer={<><Button variant="secondary" onClick={() => setForcePrompt(null)}>Go back</Button><Button variant="danger" loading={process.isPending} onClick={() => process.mutate(true)}>Process anyway</Button></>}>
          <p className="text-sm text-slate-600">{forcePrompt}</p>
          <p className="mt-2 text-sm text-slate-600">If you continue, missing marks are treated as <b>absent</b>, so those students get no GPA.</p>
        </Modal>
      )}
    </div>
  )
}

const MiniStat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="card px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-semibold text-slate-900">{value}</div></div>
)

