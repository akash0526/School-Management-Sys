import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, KeyRound, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, DL, Empty, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea } from '../../components/ui'
import { enumOptions, fieldErrors, useToast } from '../../components/ui-utils'
import { del, get, post, type Items, type Page } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { clean, date, fullName, initials, titleCase, today } from '../../lib/format'
import { sectionLabel, useCurrentYear, useDebounced, useSections } from '../../lib/hooks'
import type { Enrollment, Guardian, GuardianLink, Student } from '../../lib/types'
import { STUDENT_STATUSES } from '../../lib/types'
import { AttendanceTab, FeesTab, ResultsTab } from '../portal/Portal'
import { AccountModal } from '../../components/AccountModal'
import { GuardianEditModal } from '../guardians/GuardianEditModal'
import { OptionalSubjectsCard } from './OptionalSubjects'
import { StudentFormModal } from './StudentForm'

type Tab = 'profile' | 'guardians' | 'enrollment' | 'attendance' | 'results' | 'fees'
const RELATIONS = ['father', 'mother', 'grandfather', 'grandmother', 'brother', 'sister', 'uncle', 'aunt', 'other'] as const

export function StudentDetailPage() {
  const id = Number(useParams().id)
  const { can } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('profile')
  const [modal, setModal] = useState<null | 'edit' | 'status' | 'account' | 'enroll'>(null)
  const { data: s, isLoading, error } = useQuery({ queryKey: ['student', id], queryFn: () => get<Student>(`/students/${id}`) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['student', id] })
    void qc.invalidateQueries({ queryKey: ['students'] })
  }

  if (isLoading) return <Spinner />
  if (error || !s) return <ErrorBox error={error ?? 'Student not found'} />
  const manage = can('students.manage')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'guardians', label: 'Guardians' },
    { id: 'enrollment', label: 'Enrollment' },
    ...(can('attendance.view', 'attendance.mark', 'attendance.mark_any') ? [{ id: 'attendance' as Tab, label: 'Attendance' }] : []),
    ...(can('results.view') ? [{ id: 'results' as Tab, label: 'Results' }] : []),
    ...(can('fees.view') ? [{ id: 'fees' as Tab, label: 'Fees' }] : []),
  ]

  return (
    <>
      <PageHeader
        back={<Link to="/students" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="size-4" /> Students</Link>}
        title={
          <span className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">{initials(fullName(s))}</span>
            <span>
              {fullName(s)} <span className="ml-1 align-middle"><StatusBadge status={s.status} /></span>
              {s.fullNameNp && <span className="block text-sm font-normal text-slate-500">{s.fullNameNp}</span>}
            </span>
          </span>
        }
        subtitle={`Adm. ${s.admissionNo}${s.className ? ` · ${s.className} – ${s.sectionName}` : ' · not enrolled this year'}${s.rollNo ? ` · Roll ${s.rollNo}` : ''}`}
        actions={
          <>
            {can('enrollment.manage') && !s.enrollmentId && s.status === 'active' && <Button icon={<Plus className="size-4" />} onClick={() => setModal('enroll')}>Enroll</Button>}
            {manage && !s.userId && s.status === 'active' && <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setModal('account')}>Create login</Button>}
            {manage && <Button variant="secondary" onClick={() => setModal('status')}>Change status</Button>}
            {manage && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setModal('edit')}>Edit</Button>}
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {tab === 'profile' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Personal" className="lg:col-span-2">
            <DL cols={3} items={[
              ['Gender', titleCase(s.gender)], ['Date of birth', date(s.dob)], ['Blood group', s.bloodGroup],
              ['Phone', s.phone], ['Email', s.email], ['Nationality', s.nationality],
              ['Mother tongue', s.motherTongue], ['Caste / ethnicity', s.casteEthnicity], ['Religion', s.religion],
              ['Birth certificate', s.birthCertNo], ['Disability', s.disabilityType], ['Previous school', s.previousSchool],
            ]} />
          </Card>
          <Card title="School">
            <DL cols={2} items={[
              ['Admission date', date(s.admissionDate)], ['Status', <StatusBadge key="status" status={s.status} />],
              ['Class', s.className ? `${s.className} – ${s.sectionName}` : null], ['Roll no.', s.rollNo],
              ['Login', s.userId ? <Badge key="login" tone="green">Has account</Badge> : <Badge key="login">None</Badge>], ['Left on', s.leftDate ? date(s.leftDate) : null],
            ]} />
          </Card>
          <Card title="Address" className="lg:col-span-3">
            <DL cols={3} items={[['Province', s.province], ['District', s.district], ['Municipality', s.localLevel], ['Ward', s.wardNo], ['Tole', s.tole], ['Temporary address', s.temporaryAddress]]} />
          </Card>
        </div>
      )}
      {tab === 'guardians' && <GuardiansTab studentId={id} manage={manage} />}
      {tab === 'enrollment' && (
        <div className="space-y-6">
          {s.enrollmentId && <OptionalSubjectsCard enrollmentId={s.enrollmentId} />}
          <EnrollmentHistory studentId={id} />
        </div>
      )}
      {tab === 'attendance' && <AttendanceTab studentId={id} />}
      {tab === 'results' && <ResultsTab studentId={id} />}
      {tab === 'fees' && <FeesTab studentId={id} />}

      {modal === 'edit' && <StudentFormModal open student={s} onClose={() => setModal(null)} onSaved={() => { toast.success('Saved'); setModal(null); refresh() }} />}
      {modal === 'status' && <StatusModal student={s} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh() }} />}
      {modal === 'account' && <AccountModal path={`/students/${id}/account`} title="Create student login" onClose={() => setModal(null)} onDone={refresh} suggested={s.admissionNo.toLowerCase().replace(/[^a-z0-9._-]/g, '')} />}
      {modal === 'enroll' && <EnrollModal studentId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh() }} />}
    </>
  )
}

function StatusModal({ student, onClose, onDone }: { student: Student; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [status, setStatus] = useState(student.status)
  const [d, setD] = useState(today())
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => post(`/students/${student.id}/status`, clean({ status, date: d, reason })),
    onSuccess: () => { toast.success('Status updated'); onDone() },
  })
  const leaving = ['transferred', 'left', 'graduated', 'dropped'].includes(status)
  return (
    <Modal open onClose={onClose} title="Change student status" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={leaving ? 'danger' : 'primary'} loading={m.isPending} onClick={() => m.mutate()} disabled={status === student.status}>Update status</Button></>}>
      <div className="space-y-4">
        <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={enumOptions(STUDENT_STATUSES)} /></Field>
        <Field label="Effective date"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label="Reason (optional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        {leaving && <Notice tone="amber">The student's login (if any) is disabled immediately.</Notice>}
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}

function EnrollModal({ studentId, onClose, onDone }: { studentId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const year = useCurrentYear().data
  const sections = useSections(year?.id)
  const [sectionId, setSectionId] = useState('')
  const [rollNo, setRollNo] = useState('')
  const [symbolNo, setSymbolNo] = useState('')
  const m = useMutation({
    mutationFn: () => post('/enrollments', clean({ studentId, sectionId: Number(sectionId), rollNo: rollNo ? Number(rollNo) : null, symbolNo })),
    onSuccess: () => { toast.success('Enrolled'); onDone() },
  })
  return (
    <Modal open onClose={onClose} title={`Enroll for ${year?.name ?? ''}`} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!sectionId} onClick={() => m.mutate()}>Enroll</Button></>}>
      <div className="space-y-4">
        <Field label="Section"><Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder="Select class & section" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount}${s.capacity ? `/${s.capacity}` : ''}` }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Roll no. (optional)"><Input type="number" min={1} max={999} value={rollNo} onChange={(e) => setRollNo(e.target.value)} /></Field>
          <Field label="Symbol no. (optional)"><Input value={symbolNo} onChange={(e) => setSymbolNo(e.target.value)} maxLength={30} /></Field>
        </div>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}

function EnrollmentHistory({ studentId }: { studentId: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['enrollments', 'student', studentId], queryFn: () => get<Items<Enrollment>>('/enrollments', { studentId }) })
  if (isLoading) return <Spinner />
  return (
    <Card padded={false}>
      {!data?.items.length ? <Empty title="No enrollments" hint="Use “Enroll” to place the student in a section." /> : (
        <table className="table-base">
          <thead><tr><th>Year</th><th>Class</th><th>Roll</th><th>Symbol no.</th><th>Enrolled on</th><th>Status</th></tr></thead>
          <tbody>
            {data.items.map((e) => (
              <tr key={e.id}><td className="font-medium">{e.academicYear}</td><td>{e.className} – {e.sectionName}</td><td>{e.rollNo ?? '—'}</td><td>{e.symbolNo ?? '—'}</td><td>{date(e.enrolledOn)}</td><td><StatusBadge status={e.status} /></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function GuardiansTab({ studentId, manage }: { studentId: number; manage: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [loginFor, setLoginFor] = useState<GuardianLink | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const key = ['guardians-of', studentId]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => get<Items<GuardianLink>>(`/students/${studentId}/guardians`) })
  const remove = useMutation({
    mutationFn: (gid: number) => del(`/students/${studentId}/guardians/${gid}`),
    onSuccess: () => { toast.success('Guardian removed'); void qc.invalidateQueries({ queryKey: key }) },
    onError: toast.error,
  })
  if (isLoading) return <Spinner />
  return (
    <>
      <Card title="Guardians" padded={false} actions={manage && <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add guardian</Button>}>
        {!data?.items.length ? <Empty title="No guardians linked" /> : (
          <ul className="divide-y divide-slate-100">
            {data.items.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initials(g.fullName)}</div>
                  <div>
                    <div className="font-medium text-slate-900">{g.fullName} {g.isPrimary && <Badge tone="indigo">Primary</Badge>}</div>
                    <div className="text-sm text-slate-500">{titleCase(g.relation)} · {g.phone}{g.altPhone ? ` / ${g.altPhone}` : ''}{g.email ? ` · ${g.email}` : ''}</div>
                    {!g.canPickup && <div className="text-xs text-amber-600">Not allowed to pick up</div>}
                  </div>
                </div>
                {manage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(g.id)} aria-label={`Edit guardian ${g.fullName}`}>Edit</Button>
                    {g.userId ? <Badge tone="green">Has parent login</Badge> : <Button size="sm" variant="secondary" icon={<KeyRound className="size-3.5" />} onClick={() => setLoginFor(g)}>Parent login</Button>}
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} loading={remove.isPending && remove.variables === g.id} onClick={() => confirm(`Remove ${g.fullName} from this student?`) && remove.mutate(g.id)}>Remove</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding && <AddGuardianModal studentId={studentId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: key }) }} />}
      {loginFor && <AccountModal path={`/guardians/${loginFor.id}/account`} title={`Parent login for ${loginFor.fullName}`} suggested={loginFor.phone.replace(/[^0-9]/g, '')} onClose={() => setLoginFor(null)} onDone={() => void qc.invalidateQueries({ queryKey: key })} />}
      {editing && <GuardianEditModal guardianId={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function AddGuardianModal({ studentId, onClose, onDone }: { studentId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [relation, setRelation] = useState('father')
  const [isPrimary, setIsPrimary] = useState(false)
  const [canPickup, setCanPickup] = useState(true)
  const [g, setG] = useState({ fullName: '', phone: '', altPhone: '', email: '', occupation: '', address: '' })
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<Guardian | null>(null)
  const q = useDebounced(term.trim())
  const search = useQuery({ queryKey: ['guardian-search', q], queryFn: () => get<Page<Guardian>>('/guardians', { search: q, pageSize: 8 }), enabled: mode === 'existing' && q.length >= 2 })
  const m = useMutation({
    mutationFn: () => post(`/students/${studentId}/guardians`, mode === 'new' ? { guardian: clean(g), relation, isPrimary, canPickup } : { guardianId: picked!.id, relation, isPrimary, canPickup }),
    onSuccess: () => { toast.success('Guardian added'); onDone() },
  })
  const errs = fieldErrors(m.error)
  const set = (k: keyof typeof g) => (e: { target: { value: string } }) => setG((s) => ({ ...s, [k]: e.target.value }))
  function submit(e: FormEvent) { e.preventDefault(); m.mutate() }

  return (
    <Modal open onClose={onClose} title="Add guardian" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="guardian-form" loading={m.isPending} disabled={mode === 'existing' && !picked}>Add guardian</Button></>}>
      <form id="guardian-form" onSubmit={submit} className="space-y-4">
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          {(['new', 'existing'] as const).map((x) => (
            <button key={x} type="button" onClick={() => setMode(x)} className={`rounded-md px-3 py-1.5 font-medium ${mode === x ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {x === 'new' ? 'New guardian' : 'Existing (sibling)'}
            </button>
          ))}
        </div>
        {mode === 'new' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name *" error={errs.guardian} className="sm:col-span-2"><Input value={g.fullName} onChange={set('fullName')} required maxLength={150} /></Field>
            <Field label="Phone *"><Input value={g.phone} onChange={set('phone')} required placeholder="98XXXXXXXX" /></Field>
            <Field label="Alternate phone"><Input value={g.altPhone} onChange={set('altPhone')} /></Field>
            <Field label="Email"><Input type="email" value={g.email} onChange={set('email')} /></Field>
            <Field label="Occupation"><Input value={g.occupation} onChange={set('occupation')} maxLength={100} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={g.address} onChange={set('address')} maxLength={500} /></Field>
          </div>
        ) : picked ? (
          <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
            <span><b>{picked.fullName}</b> · {picked.phone}</span>
            <button type="button" className="text-slate-500 hover:text-slate-700" onClick={() => setPicked(null)}>Change</button>
          </div>
        ) : (
          <div>
            <Input placeholder="Search guardian by name or phone…" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
              {search.data?.items.map((x) => (
                <button type="button" key={x.id} onClick={() => setPicked(x)} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50">
                  <b>{x.fullName}</b> <span className="text-slate-500">· {x.phone}</span>
                </button>
              ))}
              {q.length >= 2 && search.data?.items.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No match</div>}
              {q.length < 2 && <div className="px-3 py-2 text-sm text-slate-400">Type at least 2 characters</div>}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Relation"><Select value={relation} onChange={(e) => setRelation(e.target.value)} options={enumOptions(RELATIONS)} /></Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <Checkbox label="Primary contact" checked={isPrimary} onChange={setIsPrimary} />
            <Checkbox label="Can pick up the student" checked={canPickup} onChange={setCanPickup} />
          </div>
        </div>
        <ErrorBox error={m.error} />
      </form>
    </Modal>
  )
}
