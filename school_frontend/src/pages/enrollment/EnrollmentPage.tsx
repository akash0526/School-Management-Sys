import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Hash, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentPicker } from '../../components/StudentPicker'
import { Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, Textarea } from '../../components/ui'
import { enumOptions, useToast } from '../../components/ui-utils'
import { get, patch, post, type Items } from '../../lib/api'
import { clean, date } from '../../lib/format'
import { sectionLabel, useSections, useYears, useYearPicker } from '../../lib/hooks'
import type { Enrollment, StudentRow } from '../../lib/types'

const ENROLL_STATUS = ['studying', 'promoted', 'repeated', 'transferred', 'left', 'graduated'] as const

export function EnrollmentPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const { years, yearId, setYearId } = useYearPicker()
  const sections = useSections(yearId)
  const [sectionId, setSectionId] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [modal, setModal] = useState<null | 'enroll' | 'promote'>(null)
  const [editing, setEditing] = useState<Enrollment | null>(null)

  const list = useQuery({
    queryKey: ['enrollments', 'section', sectionId],
    queryFn: () => get<Items<Enrollment>>('/enrollments', { sectionId }),
    enabled: !!sectionId,
  })
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['enrollments'] }); void qc.invalidateQueries({ queryKey: ['sections'] }) }

  const rolls = useMutation({
    mutationFn: () => post(`/enrollments/sections/${sectionId}/assign-roll-numbers`),
    onSuccess: () => { toast.success('Roll numbers assigned alphabetically'); invalidate() },
    onError: toast.error,
  })
  const items = list.data?.items ?? []
  const studying = items.filter((e) => e.status === 'studying')
  const allChecked = studying.length > 0 && studying.every((e) => selected.has(e.id))

  return (
    <>
      <PageHeader
        title="Enrollment"
        subtitle="Place students in sections, assign roll numbers and promote at year end."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setModal('enroll')}>Enroll student</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Academic year" className="w-40">
            <Select value={yearId ?? ''} onChange={(e) => { setYearId(Number(e.target.value)); setSectionId(''); setSelected(new Set()) }} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.name + (y.isCurrent ? ' (current)' : '') }))} />
          </Field>
          <Field label="Section" className="min-w-64 flex-1">
            <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setSelected(new Set()) }} placeholder="Select a section" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount} students` }))} />
          </Field>
          {sectionId && (
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Hash className="size-4" />} loading={rolls.isPending} onClick={() => confirm('Re-number roll numbers alphabetically for this section?') && rolls.mutate()}>Assign roll nos.</Button>
              <Button variant="secondary" icon={<ArrowUpRight className="size-4" />} disabled={selected.size === 0} onClick={() => setModal('promote')}>Promote {selected.size || ''}</Button>
            </div>
          )}
        </div>
        {!sectionId ? <Empty title="Choose a section" hint="Pick a class section to see its students." /> : list.isLoading ? <Spinner /> : !items.length ? <Empty title="No students in this section" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10"><input type="checkbox" className="size-4 accent-brand-600" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(studying.map((x) => x.id)) : new Set())} aria-label="Select all" /></th>
                  <th>Roll</th><th>Student</th><th>Admission no.</th><th>Symbol no.</th><th>Enrolled</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td><input type="checkbox" className="size-4 accent-brand-600" disabled={e.status !== 'studying'} checked={selected.has(e.id)} onChange={(ev) => setSelected((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n })} /></td>
                    <td className="font-medium">{e.rollNo ?? '—'}</td>
                    <td><Link to={`/students/${e.studentId}`} className="font-medium text-slate-900 hover:text-brand-600">{e.studentName}</Link></td>
                    <td className="font-mono text-xs">{e.admissionNo}</td>
                    <td>{e.symbolNo ?? '—'}</td>
                    <td>{date(e.enrolledOn)}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal === 'enroll' && <EnrollModal yearId={yearId} defaultSection={sectionId} onClose={() => setModal(null)} onDone={() => { setModal(null); invalidate() }} />}
      {modal === 'promote' && <PromoteModal ids={[...selected]} onClose={() => setModal(null)} onDone={() => { setModal(null); setSelected(new Set()); invalidate() }} />}
      {editing && <EditEnrollment e={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); invalidate() }} />}
    </>
  )
}

function EnrollModal({ yearId, defaultSection, onClose, onDone }: { yearId?: number; defaultSection: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const sections = useSections(yearId)
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [sectionId, setSectionId] = useState(defaultSection)
  const [rollNo, setRollNo] = useState('')
  const [symbolNo, setSymbolNo] = useState('')
  const [registrationNo, setReg] = useState('')
  const m = useMutation({
    mutationFn: () => post('/enrollments', clean({ studentId: student!.id, sectionId: Number(sectionId), rollNo: rollNo ? Number(rollNo) : null, symbolNo, registrationNo })),
    onSuccess: () => { toast.success('Student enrolled'); onDone() },
  })
  return (
    <Modal open onClose={onClose} title="Enroll student" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!student || !sectionId} onClick={() => m.mutate()}>Enroll</Button></>}>
      <div className="space-y-4">
        <Field label="Student"><StudentPicker value={student} onChange={setStudent} /></Field>
        {student?.className && <Notice tone="amber">Already enrolled in {student.className} – {student.sectionName} this year.</Notice>}
        <Field label="Section"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Select" options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionLabel(s) }))} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Roll no."><Input type="number" min={1} max={999} value={rollNo} onChange={(e) => setRollNo(e.target.value)} /></Field>
          <Field label="Symbol no."><Input value={symbolNo} onChange={(e) => setSymbolNo(e.target.value)} maxLength={30} /></Field>
          <Field label="Registration no."><Input value={registrationNo} onChange={(e) => setReg(e.target.value)} maxLength={30} /></Field>
        </div>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}

function PromoteModal({ ids, onClose, onDone }: { ids: number[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const years = useYears()
  const [yearId, setYearId] = useState<number>()
  const sections = useSections(yearId)
  const [target, setTarget] = useState('')
  const [outcome, setOutcome] = useState<'promoted' | 'repeated'>('promoted')
  const m = useMutation({
    mutationFn: () => post<{ promoted?: number }>('/enrollments/promote', { enrollmentIds: ids, targetSectionId: Number(target), outcome }),
    onSuccess: () => { toast.success(`${ids.length} student(s) moved`); onDone() },
  })
  return (
    <Modal open onClose={onClose} title={`Promote ${ids.length} student${ids.length > 1 ? 's' : ''}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!target} onClick={() => m.mutate()}>Confirm</Button></>}>
      <div className="space-y-4">
        <Field label="Outcome">
          <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
            {(['promoted', 'repeated'] as const).map((o) => (
              <button key={o} type="button" onClick={() => setOutcome(o)} className={`rounded-md px-3 py-1.5 font-medium ${outcome === o ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{o === 'promoted' ? 'Promote' : 'Repeat class'}</button>
            ))}
          </div>
        </Field>
        <Field label="Target academic year"><Select value={yearId ?? ''} onChange={(e) => { setYearId(Number(e.target.value)); setTarget('') }} placeholder="Select year" options={(years.data ?? []).map((y) => ({ value: y.id, label: y.name }))} /></Field>
        <Field label="Target section"><Select value={target} disabled={!yearId} onChange={(e) => setTarget(e.target.value)} placeholder="Select section" options={(sections.data ?? []).map((s) => ({ value: s.id, label: sectionLabel(s) }))} /></Field>
        <p className="text-xs text-slate-500">Current enrollments are closed as “{outcome}” and new ones are created in the target section.</p>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}

function EditEnrollment({ e, onClose, onDone }: { e: Enrollment; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ rollNo: e.rollNo ? String(e.rollNo) : '', symbolNo: e.symbolNo ?? '', registrationNo: e.registrationNo ?? '', status: e.status, remarks: '' })
  const m = useMutation({
    mutationFn: () => patch(`/enrollments/${e.id}`, clean({ rollNo: f.rollNo ? Number(f.rollNo) : null, symbolNo: f.symbolNo, registrationNo: f.registrationNo, status: f.status, ...(f.remarks ? { remarks: f.remarks } : {}) })),
    onSuccess: () => { toast.success('Enrollment updated'); onDone() },
  })
  return (
    <Modal open onClose={onClose} title={`Edit enrollment · ${e.studentName}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Roll no."><Input type="number" min={1} max={999} value={f.rollNo} onChange={(ev) => setF({ ...f, rollNo: ev.target.value })} /></Field>
          <Field label="Symbol no." className="col-span-2"><Input value={f.symbolNo} onChange={(ev) => setF({ ...f, symbolNo: ev.target.value })} maxLength={30} /></Field>
        </div>
        <Field label="Registration no."><Input value={f.registrationNo} onChange={(ev) => setF({ ...f, registrationNo: ev.target.value })} maxLength={30} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(ev) => setF({ ...f, status: ev.target.value })} options={enumOptions(ENROLL_STATUS)} /></Field>
        <Field label="Remarks"><Textarea value={f.remarks} onChange={(ev) => setF({ ...f, remarks: ev.target.value })} maxLength={500} /></Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}
