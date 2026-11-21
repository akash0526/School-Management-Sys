import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, Plus, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, Checkbox, DL, Empty, ErrorBox, Field, Input, Modal, Notice, Pagination, PageHeader, Select, Spinner, StatusBadge, Textarea } from '../../components/ui'
import { enumOptions, fieldErrors, useToast } from '../../components/ui-utils'
import { get, patch, post, type Items, type Page } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { clean, date, fullName, initials, titleCase, today } from '../../lib/format'
import { keepPreviousData, useDebounced } from '../../lib/hooks'
import type { Role, Staff } from '../../lib/types'
import { AccountModal } from '../../components/AccountModal'

const STAFF_STATUS = ['active', 'on_leave', 'resigned', 'retired', 'terminated'] as const
const STAFF_TYPE = ['teaching', 'non_teaching'] as const
const EMPLOYMENT = ['permanent', 'temporary', 'contract', 'part_time'] as const
const STAFF_ROLES = ['teacher', 'admin_staff', 'accountant', 'librarian', 'principal']

interface Dept { id: number; name: string }

export function StaffPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [staffType, setStaffType] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Staff | null>(null)
  const [editing, setEditing] = useState<Staff | 'new' | null>(null)
  const [deptOpen, setDeptOpen] = useState(false)
  const q = useDebounced(search.trim())
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, error } = useQuery({
    queryKey: ['staff', q, status, staffType, page],
    queryFn: () => get<Page<Staff>>('/staff', { search: q, status, staffType, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })
  const manage = can('staff.manage')

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={data ? `${data.total} staff members` : undefined}
        actions={manage && (
          <>
            <Button variant="secondary" onClick={() => setDeptOpen(true)}>Departments</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Add staff</Button>
          </>
        )}
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search name, employee no. or phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <Select className="w-40" value={staffType} onChange={(e) => { setStaffType(e.target.value); setPage(1) }} placeholder="All types" options={enumOptions(STAFF_TYPE)} />
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} placeholder="All statuses" options={enumOptions(STAFF_STATUS)} />
        </div>
        <ErrorBox error={error} className="m-4" />
        {isLoading ? <Spinner /> : !data?.items.length ? <Empty title="No staff found" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Name</th><th>Employee no.</th><th>Designation</th><th>Type</th><th>Phone</th><th>Login</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => setSelected(s)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-full bg-sky-50 text-xs font-semibold text-sky-700">{initials(fullName(s))}</div>
                        <div>
                          <div className="font-medium text-slate-900">{fullName(s)}</div>
                          {s.departmentName && <div className="text-xs text-slate-500">{s.departmentName}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{s.employeeNo}</td>
                    <td>{s.designation}</td>
                    <td>{titleCase(s.staffType)}</td>
                    <td>{s.phone}</td>
                    <td>{s.userId ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>

      {selected && (
        <StaffDrawer
          staff={selected}
          manage={manage}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null) }}
          onChanged={() => void qc.invalidateQueries({ queryKey: ['staff'] })}
        />
      )}
      {editing && (
        <StaffForm
          staff={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { toast.success('Saved'); setEditing(null); void qc.invalidateQueries({ queryKey: ['staff'] }); void qc.invalidateQueries({ queryKey: ['staff-all'] }) }}
        />
      )}
      {deptOpen && <DepartmentsModal onClose={() => setDeptOpen(false)} />}
    </>
  )
}

function StaffDrawer({ staff: s, manage, onClose, onEdit, onChanged }: { staff: Staff; manage: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { can } = useAuth()
  const [account, setAccount] = useState(false)
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Items<Role>>('/users/roles'), enabled: can('users.manage') })
  const roleOptions = roles.data ? roles.data.items.map((r) => r.name).filter((r) => !['parent', 'student'].includes(r)) : STAFF_ROLES
  return (
    <>
      <Modal open onClose={onClose} title={fullName(s)} size="lg" footer={manage && (
        <>
          {!s.userId && s.status === 'active' && <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setAccount(true)}>Create login</Button>}
          <Button icon={<Pencil className="size-4" />} onClick={onEdit}>Edit</Button>
        </>
      )}>
        <div className="mb-4 flex items-center gap-2"><StatusBadge status={s.status} /><Badge tone="blue">{titleCase(s.staffType)}</Badge><Badge>{titleCase(s.employmentType)}</Badge></div>
        <DL cols={3} items={[
          ['Employee no.', s.employeeNo], ['Designation', s.designation], ['Department', s.departmentName],
          ['Phone', s.phone], ['Email', s.email], ['Gender', titleCase(s.gender)],
          ['Joined', date(s.joinDate)], ['Left', s.leaveDate ? date(s.leaveDate) : null], ['Date of birth', date(s.dob)],
          ['Qualification', s.qualification], ['Teaching license', s.teachingLicenseNo], ['Citizenship no.', s.citizenshipNo],
          ['PAN', s.panNo], ['Bank', s.bankName], ['Account no.', s.bankAccountNo],
          ['Address', s.address], ['On website', s.showOnWebsite ? 'Yes' : 'No'], ['Login', s.userId ? 'Yes' : 'No'],
        ]} />
        {s.publicBio && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{s.publicBio}</p>}
      </Modal>
      {account && (
        <AccountModal
          path={`/staff/${s.id}/account`}
          title={`Create login for ${fullName(s)}`}
          suggested={`${s.firstName}.${s.lastName}`.toLowerCase().replace(/[^a-z0-9._-]/g, '')}
          roles={{ options: roleOptions, initial: s.staffType === 'teaching' ? ['teacher'] : [] }}
          onClose={() => { setAccount(false); onClose() }}
          onDone={onChanged}
        />
      )}
    </>
  )
}

const emptyStaff = {
  employeeNo: '', firstName: '', middleName: '', lastName: '', gender: 'female', dob: '', phone: '', email: '', address: '',
  departmentId: '', designation: '', staffType: 'teaching', employmentType: 'permanent', qualification: '', teachingLicenseNo: '',
  citizenshipNo: '', panNo: '', bankName: '', bankAccountNo: '', joinDate: today(), leaveDate: '', status: 'active', publicBio: '',
}

function StaffForm({ staff, onClose, onSaved }: { staff?: Staff; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() =>
    staff ? (Object.fromEntries(Object.keys(emptyStaff).map((k) => [k, (staff as unknown as Record<string, unknown>)[k] == null ? '' : String((staff as unknown as Record<string, unknown>)[k])])) as typeof emptyStaff) : emptyStaff,
  )
  const [showOnWebsite, setShow] = useState(staff?.showOnWebsite ?? false)
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => get<Items<Dept>>('/staff/departments') })
  const m = useMutation({
    mutationFn: () => {
      const body = clean({ ...f, departmentId: f.departmentId ? Number(f.departmentId) : null, showOnWebsite })
      return staff ? patch(`/staff/${staff.id}`, body) : post('/staff', body)
    },
    onSuccess: onSaved,
  })
  const errs = fieldErrors(m.error)
  const set = (k: keyof typeof emptyStaff) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const leaving = staff && staff.status === 'active' && ['resigned', 'retired', 'terminated'].includes(f.status)
  function submit(e: FormEvent) { e.preventDefault(); m.mutate() }
  return (
    <Modal open onClose={onClose} size="xl" title={staff ? `Edit ${fullName(staff)}` : 'Add staff member'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="staff-form" loading={m.isPending}>{staff ? 'Save changes' : 'Add staff'}</Button></>}>
      <form id="staff-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Employee no. *" error={errs.employeeNo}><Input value={f.employeeNo} onChange={set('employeeNo')} required maxLength={30} /></Field>
          <Field label="Designation *" error={errs.designation}><Input value={f.designation} onChange={set('designation')} required maxLength={80} placeholder="e.g. Secondary Teacher" /></Field>
          <Field label="Department" error={errs.departmentId}><Select value={f.departmentId} onChange={set('departmentId')} placeholder="—" options={(depts.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
          <Field label="First name *" error={errs.firstName}><Input value={f.firstName} onChange={set('firstName')} required maxLength={50} /></Field>
          <Field label="Middle name" error={errs.middleName}><Input value={f.middleName} onChange={set('middleName')} maxLength={50} /></Field>
          <Field label="Last name *" error={errs.lastName}><Input value={f.lastName} onChange={set('lastName')} required maxLength={50} /></Field>
          <Field label="Gender *"><Select value={f.gender} onChange={set('gender')} options={enumOptions(['male', 'female', 'other'])} /></Field>
          <Field label="Phone *" error={errs.phone}><Input value={f.phone} onChange={set('phone')} required /></Field>
          <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Staff type *"><Select value={f.staffType} onChange={set('staffType')} options={enumOptions(STAFF_TYPE)} /></Field>
          <Field label="Employment"><Select value={f.employmentType} onChange={set('employmentType')} options={enumOptions(EMPLOYMENT)} /></Field>
          <Field label="Status"><Select value={f.status} onChange={set('status')} options={enumOptions(STAFF_STATUS)} /></Field>
          <Field label="Join date *" error={errs.joinDate}><Input type="date" value={f.joinDate} onChange={set('joinDate')} required /></Field>
          <Field label="Leave date" error={errs.leaveDate}><Input type="date" value={f.leaveDate} onChange={set('leaveDate')} /></Field>
          <Field label="Date of birth" error={errs.dob}><Input type="date" value={f.dob} onChange={set('dob')} /></Field>
          <Field label="Qualification"><Input value={f.qualification} onChange={set('qualification')} maxLength={150} /></Field>
          <Field label="Teaching license no."><Input value={f.teachingLicenseNo} onChange={set('teachingLicenseNo')} maxLength={50} /></Field>
          <Field label="Citizenship no."><Input value={f.citizenshipNo} onChange={set('citizenshipNo')} maxLength={50} /></Field>
          <Field label="PAN no."><Input value={f.panNo} onChange={set('panNo')} maxLength={20} /></Field>
          <Field label="Bank name"><Input value={f.bankName} onChange={set('bankName')} maxLength={100} /></Field>
          <Field label="Bank account no."><Input value={f.bankAccountNo} onChange={set('bankAccountNo')} maxLength={50} /></Field>
          <Field label="Address" className="sm:col-span-3"><Input value={f.address} onChange={set('address')} maxLength={500} /></Field>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <Checkbox label="Show on the public website" checked={showOnWebsite} onChange={setShow} />
          {showOnWebsite && <Textarea placeholder="Short public bio" value={f.publicBio} onChange={set('publicBio')} maxLength={2000} />}
        </div>
        {leaving && <Notice tone="amber">This staff member's login will be disabled immediately.</Notice>}
        <ErrorBox error={m.error} />
      </form>
    </Modal>
  )
}

function DepartmentsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => get<Items<Dept>>('/staff/departments') })
  const m = useMutation({ mutationFn: () => post('/staff/departments', { name }), onSuccess: () => { setName(''); void qc.invalidateQueries({ queryKey: ['departments'] }) } })
  return (
    <Modal open onClose={onClose} title="Departments" size="sm">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate() }}>
        <Input placeholder="New department name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <Button type="submit" loading={m.isPending}>Add</Button>
      </form>
      <ErrorBox error={m.error} className="mb-3" />
      {depts.data?.items.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{depts.data.items.map((d) => <li key={d.id} className="px-3 py-2 text-sm">{d.name}</li>)}</ul>
      ) : <p className="text-sm text-slate-500">No departments yet.</p>}
    </Modal>
  )
}
