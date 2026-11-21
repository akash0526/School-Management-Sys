import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Tabs } from '../../components/ui'
import { enumOptions, useToast } from '../../components/ui-utils'
import { del, get, patch, post, type Items } from '../../lib/api'
import { clean, date, fullName, titleCase } from '../../lib/format'
import { sectionLabel, useClassSubjects, useClasses, useRooms, useSections, useStaffList, useStreams, useSubjects, useYears, useYearPicker } from '../../lib/hooks'
import type { Assignment, CalendarEntry, Section, Term } from '../../lib/types'

type Tab = 'years' | 'sections' | 'subjects' | 'class-subjects' | 'teachers' | 'calendar'

export function AcademicPage() {
  const { years, yearId, setYearId } = useYearPicker()
  const [tab, setTab] = useState<Tab>('sections')

  return (
    <>
      <PageHeader
        title="Academic setup"
        subtitle="Years, classes, sections, subjects and the school calendar."
        actions={years.data && (
          <Select className="w-44" value={yearId ?? ''} onChange={(e) => setYearId(Number(e.target.value))} options={years.data.map((y) => ({ value: y.id, label: `Year ${y.name}${y.isCurrent ? ' (current)' : ''}` }))} />
        )}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'sections', label: 'Sections' },
          { id: 'class-subjects', label: 'Class subjects' },
          { id: 'teachers', label: 'Teacher assignments' },
          { id: 'subjects', label: 'Subjects' },
          { id: 'calendar', label: 'Calendar' },
          { id: 'years', label: 'Academic years' },
        ]}
      />
      {!yearId && tab !== 'years' && tab !== 'subjects' ? (
        years.isLoading ? <Spinner /> : <Card><Empty title="No academic year yet" hint="Create one in the Academic years tab." action={<Button onClick={() => setTab('years')}>Create year</Button>} /></Card>
      ) : (
        <>
          {tab === 'years' && <YearsTab />}
          {tab === 'sections' && yearId && <SectionsTab yearId={yearId} />}
          {tab === 'subjects' && <SubjectsTab />}
          {tab === 'class-subjects' && yearId && <ClassSubjectsTab yearId={yearId} />}
          {tab === 'teachers' && yearId && <TeachersTab yearId={yearId} />}
          {tab === 'calendar' && yearId && <CalendarTab yearId={yearId} />}
        </>
      )}
    </>
  )
}

/** Small helper: a modal form with one mutation. */
function FormModal({ title, open, onClose, onSubmit, pending, error, children, submitLabel = 'Save' }: { title: string; open: boolean; onClose: () => void; onSubmit: () => void; pending: boolean; error: unknown; children: ReactNode; submitLabel?: string }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="fm" loading={pending}>{submitLabel}</Button></>}>
      <form id="fm" className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit() }}>
        {children}
        <ErrorBox error={error} />
      </form>
    </Modal>
  )
}

function useCreate(path: string | (() => string), invalidate: unknown[], onDone: () => void, success = 'Saved') {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: unknown) => post(typeof path === 'function' ? path() : path, body),
    onSuccess: () => { toast.success(success); onDone(); for (const k of invalidate) void qc.invalidateQueries({ queryKey: k as unknown[] }) },
  })
}

/* ───── Years & terms ───── */
function YearsTab() {
  const years = useYears()
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ name: '', startDate: '', endDate: '' })
  const create = useCreate('/academic/years', [['years']], () => setOpen(false), 'Academic year created')
  const setCurrent = useMutation({
    mutationFn: (id: number) => post(`/academic/years/${id}/set-current`),
    onSuccess: () => { toast.success('Current year changed'); void qc.invalidateQueries() },
    onError: toast.error,
  })
  return (
    <div className="space-y-6">
      <Card title="Academic years" padded={false} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New year</Button>}>
        {years.isLoading ? <Spinner /> : !years.data?.length ? <Empty /> : (
          <table className="table-base">
            <thead><tr><th>Year (BS)</th><th>Starts</th><th>Ends</th><th></th></tr></thead>
            <tbody>
              {years.data.map((y) => (
                <tr key={y.id}>
                  <td className="font-medium">{y.name} {y.isCurrent && <Badge tone="green">Current</Badge>}</td>
                  <td>{date(y.startDate)}</td><td>{date(y.endDate)}</td>
                  <td className="text-right">{!y.isCurrent && <Button size="sm" variant="secondary" loading={setCurrent.isPending} onClick={() => confirm(`Make ${y.name} the current year?`) && setCurrent.mutate(y.id)}>Set as current</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {years.data?.map((y) => <TermsCard key={y.id} yearId={y.id} yearName={y.name} />)}
      <FormModal title="New academic year" open={open} onClose={() => setOpen(false)} pending={create.isPending} error={create.error} onSubmit={() => create.mutate(f)}>
        <Field label="Name (BS year)" hint="e.g. 2084"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={20} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date (AD)"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></Field>
          <Field label="End date (AD)"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required /></Field>
        </div>
      </FormModal>
    </div>
  )
}

function TermsCard({ yearId, yearName }: { yearId: number; yearName: string }) {
  const [open, setOpen] = useState(false)
  const terms = useQuery({ queryKey: ['terms', yearId], queryFn: () => get<Items<Term>>(`/academic/years/${yearId}/terms`) })
  const [f, setF] = useState({ name: '', sequence: '1', startDate: '', endDate: '' })
  const create = useCreate(`/academic/years/${yearId}/terms`, [['terms', yearId]], () => setOpen(false), 'Term added')
  return (
    <Card title={`Terms · ${yearName}`} padded={false} actions={<Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => { setF({ ...f, sequence: String((terms.data?.items.length ?? 0) + 1) }); setOpen(true) }}>Add term</Button>}>
      {!terms.data?.items.length ? <div className="px-5 py-4 text-sm text-slate-500">No terms defined.</div> : (
        <table className="table-base">
          <thead><tr><th>#</th><th>Term</th><th>Starts</th><th>Ends</th></tr></thead>
          <tbody>{terms.data.items.map((t) => <tr key={t.id}><td>{t.sequence}</td><td className="font-medium">{t.name}</td><td>{date(t.startDate)}</td><td>{date(t.endDate)}</td></tr>)}</tbody>
        </table>
      )}
      <FormModal title="Add term" open={open} onClose={() => setOpen(false)} pending={create.isPending} error={create.error} onSubmit={() => create.mutate({ ...f, sequence: Number(f.sequence) })}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="First Term" /></Field>
          <Field label="Order"><Input type="number" min={1} max={10} value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></Field>
          <Field label="End date"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required /></Field>
        </div>
      </FormModal>
    </Card>
  )
}

/* ───── Sections ───── */
function SectionsTab({ yearId }: { yearId: number }) {
  const sections = useSections(yearId)
  const classes = useClasses()
  const streams = useStreams()
  const rooms = useRooms()
  const staff = useStaffList()
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<Section | 'new' | null>(null)
  const blank = { classId: '', streamId: '', name: '', classTeacherId: '', roomId: '', capacity: '' }
  const [f, setF] = useState(blank)
  const save = useMutation({
    mutationFn: () => {
      const common = { streamId: f.streamId ? Number(f.streamId) : null, name: f.name, classTeacherId: f.classTeacherId ? Number(f.classTeacherId) : null, roomId: f.roomId ? Number(f.roomId) : null, capacity: f.capacity ? Number(f.capacity) : null }
      return editing === 'new' ? post('/academic/sections', { ...common, academicYearId: yearId, classId: Number(f.classId) }) : patch(`/academic/sections/${(editing as Section).id}`, common)
    },
    onSuccess: () => { toast.success('Section saved'); setEditing(null); void qc.invalidateQueries({ queryKey: ['sections'] }) },
  })
  const open = (s: Section | 'new') => {
    setF(s === 'new' ? blank : { classId: String(s.classId), streamId: s.streamId ? String(s.streamId) : '', name: s.name, classTeacherId: s.classTeacherId ? String(s.classTeacherId) : '', roomId: '', capacity: s.capacity ? String(s.capacity) : '' })
    save.reset()
    setEditing(s)
  }
  const teachers = (staff.data ?? []).filter((s) => s.staffType === 'teaching')
  return (
    <Card padded={false} title="Sections" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => open('new')}>New section</Button>}>
      {sections.isLoading ? <Spinner /> : !sections.data?.length ? <Empty title="No sections for this year" /> : (
        <table className="table-base">
          <thead><tr><th>Class</th><th>Section</th><th>Stream</th><th>Class teacher</th><th>Students</th><th></th></tr></thead>
          <tbody>
            {sections.data.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.className}</td><td>{s.name}</td><td>{s.streamName ?? '—'}</td><td>{s.classTeacherName ?? <span className="text-slate-400">Not set</span>}</td>
                <td>{s.studentCount}{s.capacity ? <span className="text-slate-400"> / {s.capacity}</span> : ''}</td>
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => open(s)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <FormModal title={editing === 'new' ? 'New section' : 'Edit section'} open={!!editing} onClose={() => setEditing(null)} pending={save.isPending} error={save.error} onSubmit={() => save.mutate()}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class"><Select value={f.classId} disabled={editing !== 'new'} onChange={(e) => setF({ ...f, classId: e.target.value })} required placeholder="Select" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Section name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={20} placeholder="A" /></Field>
          <Field label="Stream (Grade 11–12)"><Select value={f.streamId} onChange={(e) => setF({ ...f, streamId: e.target.value })} placeholder="None" options={(streams.data ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
          <Field label="Capacity"><Input type="number" min={1} max={500} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
          <Field label="Class teacher"><Select value={f.classTeacherId} onChange={(e) => setF({ ...f, classTeacherId: e.target.value })} placeholder="None" options={teachers.map((t) => ({ value: t.id, label: fullName(t) }))} /></Field>
          <Field label="Room"><Select value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })} placeholder="None" options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        </div>
      </FormModal>
    </Card>
  )
}

/* ───── Subjects ───── */
function SubjectsTab() {
  const subjects = useSubjects()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ code: '', name: '', nameNp: '' })
  const [practical, setPractical] = useState(false)
  const create = useCreate('/academic/subjects', [['subjects']], () => setOpen(false), 'Subject added')
  return (
    <Card padded={false} title="Subjects" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New subject</Button>}>
      {subjects.isLoading ? <Spinner /> : !subjects.data?.length ? <Empty /> : (
        <table className="table-base">
          <thead><tr><th>Code</th><th>Name</th><th>Nepali name</th><th>Practical</th><th>Status</th></tr></thead>
          <tbody>{subjects.data.map((s) => <tr key={s.id}><td className="font-mono text-xs">{s.code}</td><td className="font-medium">{s.name}</td><td>{s.nameNp ?? '—'}</td><td>{s.hasPractical ? 'Yes' : 'No'}</td><td>{s.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td></tr>)}</tbody>
        </table>
      )}
      <FormModal title="New subject" open={open} onClose={() => setOpen(false)} pending={create.isPending} error={create.error} onSubmit={() => create.mutate(clean({ ...f, hasPractical: practical }))}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required maxLength={20} placeholder="ENG" /></Field>
          <Field label="Name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={100} placeholder="English" /></Field>
        </div>
        <Field label="Nepali name"><Input value={f.nameNp} onChange={(e) => setF({ ...f, nameNp: e.target.value })} maxLength={100} placeholder="अंग्रेजी" /></Field>
        <Checkbox label="Has a practical component" checked={practical} onChange={setPractical} />
      </FormModal>
    </Card>
  )
}

/* ───── Class subjects ───── */
function ClassSubjectsTab({ yearId }: { yearId: number }) {
  const classes = useClasses()
  const [classId, setClassId] = useState('')
  const list = useClassSubjects(yearId, classId ? Number(classId) : undefined)
  const subjects = useSubjects()
  const streams = useStreams()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ classId: '', subjectId: '', streamId: '', creditHours: '4', sequence: '' })
  const [optional, setOptional] = useState(false)
  const create = useCreate('/academic/class-subjects', [['class-subjects']], () => setOpen(false), 'Subject added to class')
  return (
    <Card padded={false} title="Subjects taught per class" actions={
      <div className="flex gap-2">
        <Select className="w-40 py-1.5" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="All classes" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setF({ ...f, classId }); setOpen(true) }}>Add</Button>
      </div>
    }>
      {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty title="No subjects assigned" /> : (
        <table className="table-base">
          <thead><tr><th>Class</th><th>Subject</th><th>Stream</th><th>Credit hours</th><th>Type</th></tr></thead>
          <tbody>{list.data.map((c) => <tr key={c.id}><td>{c.className}</td><td className="font-medium">{c.subjectName} <span className="font-mono text-xs text-slate-400">{c.subjectCode}</span></td><td>{c.streamName ?? '—'}</td><td>{c.creditHours ?? '—'}</td><td>{c.isOptional ? <Badge tone="amber">Optional</Badge> : <Badge tone="blue">Compulsory</Badge>}</td></tr>)}</tbody>
        </table>
      )}
      <FormModal title="Add subject to class" open={open} onClose={() => setOpen(false)} pending={create.isPending} error={create.error}
        onSubmit={() => create.mutate({ academicYearId: yearId, classId: Number(f.classId), subjectId: Number(f.subjectId), streamId: f.streamId ? Number(f.streamId) : null, creditHours: f.creditHours ? Number(f.creditHours) : null, isOptional: optional, ...(f.sequence ? { sequence: Number(f.sequence) } : {}) })}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class"><Select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })} required placeholder="Select" options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Subject"><Select value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })} required placeholder="Select" options={(subjects.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} /></Field>
          <Field label="Stream"><Select value={f.streamId} onChange={(e) => setF({ ...f, streamId: e.target.value })} placeholder="All / none" options={(streams.data ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
          <Field label="Credit hours" hint="Used for GPA (NEB)"><Input type="number" step="0.5" min={0.5} max={20} value={f.creditHours} onChange={(e) => setF({ ...f, creditHours: e.target.value })} /></Field>
          <Field label="Display order"><Input type="number" min={0} max={100} value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} /></Field>
        </div>
        <Checkbox label="Optional subject" checked={optional} onChange={setOptional} />
      </FormModal>
    </Card>
  )
}

/* ───── Teacher assignments ───── */
function TeachersTab({ yearId }: { yearId: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['assignments', yearId], queryFn: () => get<Items<Assignment>>('/academic/teacher-assignments', { academicYearId: yearId }) })
  const sections = useSections(yearId)
  const staff = useStaffList()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ sectionId: '', classSubjectId: '', staffId: '' })
  const section = sections.data?.find((s) => s.id === Number(f.sectionId))
  const cs = useClassSubjects(yearId, section?.classId)
  const create = useCreate('/academic/teacher-assignments', [['assignments']], () => setOpen(false), 'Teacher assigned')
  const remove = useMutation({ mutationFn: (id: number) => del(`/academic/teacher-assignments/${id}`), onSuccess: () => { toast.success('Removed'); void qc.invalidateQueries({ queryKey: ['assignments'] }) }, onError: toast.error })
  return (
    <Card padded={false} title="Who teaches what" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Assign teacher</Button>}>
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty title="No assignments yet" hint="Teachers can only mark attendance and enter marks for their assigned sections and subjects." /> : (
        <table className="table-base">
          <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th></th></tr></thead>
          <tbody>{list.data.items.map((a) => <tr key={a.id}><td>{a.className} – {a.sectionName}</td><td className="font-medium">{a.subjectName}</td><td>{a.teacherName}</td><td className="text-right"><Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => confirm('Remove this assignment?') && remove.mutate(a.id)}>Remove</Button></td></tr>)}</tbody>
        </table>
      )}
      <FormModal title="Assign teacher" open={open} onClose={() => setOpen(false)} pending={create.isPending} error={create.error} onSubmit={() => create.mutate({ sectionId: Number(f.sectionId), classSubjectId: Number(f.classSubjectId), staffId: Number(f.staffId) })}>
        <Field label="Section"><Select value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value, classSubjectId: '' })} required placeholder="Select" options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionLabel(s) }))} /></Field>
        <Field label="Subject"><Select value={f.classSubjectId} disabled={!section} onChange={(e) => setF({ ...f, classSubjectId: e.target.value })} required placeholder={section ? 'Select' : 'Pick a section first'} options={(cs.data ?? []).filter((c) => !c.streamId || c.streamId === section?.streamId).map((c) => ({ value: c.id, label: c.subjectName }))} /></Field>
        <Field label="Teacher"><Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })} required placeholder="Select" options={(staff.data ?? []).filter((s) => s.staffType === 'teaching').map((s) => ({ value: s.id, label: fullName(s) }))} /></Field>
      </FormModal>
    </Card>
  )
}

/* ───── Calendar ───── */
const DAY_TYPES = ['holiday', 'vacation', 'exam', 'event', 'half_day'] as const
function CalendarTab({ yearId }: { yearId: number }) {
  const list = useQuery({ queryKey: ['calendar', yearId], queryFn: () => get<Items<CalendarEntry>>('/academic/calendar', { academicYearId: yearId }) })
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', startDate: '', endDate: '', dayType: 'holiday' })
  const [isHoliday, setIsHoliday] = useState(true)
  const create = useCreate('/academic/calendar', [['calendar']], () => setOpen(false), 'Added to calendar')
  return (
    <Card padded={false} title="School calendar" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add entry</Button>}>
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty title="Calendar is empty" hint="Add Dashain/Tihar vacations, public holidays, exam weeks and events." /> : (
        <table className="table-base">
          <thead><tr><th>Title</th><th>From</th><th>To</th><th>Type</th><th>School closed</th></tr></thead>
          <tbody>{list.data.items.map((c) => <tr key={c.id}><td className="font-medium">{c.title}</td><td>{date(c.startDate)}</td><td>{date(c.endDate)}</td><td>{titleCase(c.dayType)}</td><td>{c.isHoliday ? <Badge tone="amber">Yes</Badge> : 'No'}</td></tr>)}</tbody>
        </table>
      )}
      <FormModal title="Add calendar entry" open={open} onClose={() => setOpen(false)} pending={create.isPending} error={create.error} onSubmit={() => create.mutate({ ...f, endDate: f.endDate || f.startDate, academicYearId: yearId, isHoliday })}>
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={150} placeholder="Dashain vacation" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="From"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></Field>
          <Field label="To"><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Type"><Select value={f.dayType} onChange={(e) => { setF({ ...f, dayType: e.target.value }); setIsHoliday(['holiday', 'vacation'].includes(e.target.value)) }} options={enumOptions(DAY_TYPES)} /></Field>
        </div>
        <Checkbox label="School is closed (blocks attendance)" checked={isHoliday} onChange={setIsHoliday} />
      </FormModal>
    </Card>
  )
}
