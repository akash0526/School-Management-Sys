import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, KeyRound, Plus, Search, ShieldCheck } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Notice, Pagination, PageHeader, SecretReveal, Select, Spinner, Tabs } from '../../components/ui'
import { fieldErrors, useToast } from '../../components/ui-utils'
import { get, patch, post, put, type Items, type Page } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { clean, dateTime, titleCase } from '../../lib/format'
import { keepPreviousData, useDebounced } from '../../lib/hooks'
import type { Role, SecurityEvent, UserRow } from '../../lib/types'

type Tab = 'users' | 'roles'

export function UsersPage() {
  const [tab, setTab] = useState<Tab>('users')
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Sign-in accounts and what each role can do." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles & permissions' }]} />
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </>
  )
}

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => get<Items<Role>>('/users/roles'), select: (d) => d.items })
}

function UsersTab() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [secret, setSecret] = useState<{ user: string; pw: string } | null>(null)
  const q = useDebounced(search.trim())
  const list = useQuery({ queryKey: ['users', q, page], queryFn: () => get<Page<UserRow>>('/users', { search: q, page, pageSize: 25 }), placeholderData: keepPreviousData })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['users'] })
  const toggle = useMutation({
    mutationFn: (u: UserRow) => patch(`/users/${u.id}`, { isActive: !u.isActive }),
    onSuccess: (_, u) => { toast.success(u.isActive ? 'Account disabled and signed out' : 'Account enabled'); invalidate() },
    onError: toast.error,
  })
  const reset = useMutation({
    mutationFn: (u: UserRow) => post<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`),
    onSuccess: (r, u) => { setSecret({ user: u.username, pw: r.temporaryPassword }); invalidate() },
    onError: toast.error,
  })

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search username…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New user</Button>
      </div>
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty title="No users" /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Username</th><th>Roles</th><th>Contact</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.data.items.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-slate-900">{u.username}{u.id === me?.userId && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td><div className="flex flex-wrap gap-1">{u.roles.length ? u.roles.map((r) => <Badge key={r} tone={r === 'super_admin' ? 'indigo' : 'gray'}>{titleCase(r)}</Badge>) : <span className="text-slate-400">None</span>}</div></td>
                  <td className="text-slate-500">{u.email ?? u.phone ?? '—'}</td>
                  <td className="text-slate-500">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</td>
                  <td>
                    {u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}
                    {u.mustChangePassword && <span className="ml-1"><Badge tone="amber">Temp password</Badge></span>}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {u.id !== me?.userId && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Roles</Button>
                        <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} loading={reset.isPending && reset.variables?.id === u.id} onClick={() => confirm(`Reset password for ${u.username}? They will be signed out everywhere.`) && reset.mutate(u)}>Reset</Button>
                        <Button size="sm" variant="ghost" className={u.isActive ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-700'} onClick={() => confirm(`${u.isActive ? 'Disable' : 'Enable'} ${u.username}?`) && toggle.mutate(u)}>{u.isActive ? 'Disable' : 'Enable'}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      {creating && <CreateUser onClose={() => setCreating(false)} onDone={invalidate} />}
      {editing && <EditRoles user={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); invalidate() }} />}
      {secret && (
        <Modal open onClose={() => setSecret(null)} title={`New password for ${secret.user}`} size="sm" footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
          <SecretReveal label="Temporary password" value={secret.pw} />
        </Modal>
      )}
    </Card>
  )
}

function RolePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const roles = useRoles()
  const { user } = useAuth()
  const mine = new Set(user?.permissions ?? [])
  const isSuper = !!user?.roles.includes('super_admin')
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(roles.data ?? []).map((r) => {
        // mirrors the API's anti-escalation rule
        const grantable = r.name === 'super_admin' ? isSuper : r.permissions.every((p) => mine.has(p))
        return (
          <label key={r.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${value.includes(r.name) ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200'} ${!grantable ? 'cursor-not-allowed opacity-50' : ''}`}>
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" disabled={!grantable} checked={value.includes(r.name)} onChange={(e) => onChange(e.target.checked ? [...value, r.name] : value.filter((x) => x !== r.name))} />
            <span><span className="font-medium text-slate-900">{titleCase(r.name)}</span>{r.description && <span className="block text-xs text-slate-500">{r.description}</span>}</span>
          </label>
        )
      })}
    </div>
  )
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ username: '', email: '', phone: '' })
  const [roles, setRoles] = useState<string[]>([])
  const m = useMutation({ mutationFn: () => post<{ username: string; temporaryPassword?: string }>('/users', clean({ ...f, roles })), onSuccess: onDone })
  const errs = fieldErrors(m.error)
  return (
    <Modal open onClose={onClose} size="lg" title="New user" footer={m.data ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!f.username || !roles.length} onClick={() => m.mutate()}>Create user</Button></>}>
      {m.data ? (
        <div className="space-y-3"><Notice tone="green">User <b>{m.data.username}</b> created.</Notice>{m.data.temporaryPassword && <SecretReveal label="Temporary password" value={m.data.temporaryPassword} />}</div>
      ) : (
        <div className="space-y-4">
          <Notice>For staff, students and parents, prefer “Create login” on their profile so the account is linked to the person.</Notice>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Username" error={errs.username}><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} maxLength={50} /></Field>
            <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Phone" error={errs.phone}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Field label="Roles" error={errs.roles}><RolePicker value={roles} onChange={setRoles} /></Field>
          <p className="text-xs text-slate-500">A temporary password is generated and must be changed at first sign-in.</p>
          <ErrorBox error={m.error} />
        </div>
      )}
    </Modal>
  )
}

function EditRoles({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [roles, setRoles] = useState<string[]>(user.roles)
  const m = useMutation({ mutationFn: () => put(`/users/${user.id}/roles`, { roles }), onSuccess: () => { toast.success('Roles updated. The user is signed out to apply them.'); onDone() } })
  return (
    <Modal open onClose={onClose} size="lg" title={`Roles · ${user.username}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save roles</Button></>}>
      <div className="space-y-4">
        <RolePicker value={roles} onChange={setRoles} />
        <p className="text-xs text-slate-500">You can only grant roles whose permissions you already hold.</p>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}

function RolesTab() {
  const roles = useRoles()
  if (roles.isLoading) return <Spinner />
  const perms = [...new Set((roles.data ?? []).flatMap((r) => r.permissions))].sort()
  const groups = perms.reduce<Record<string, string[]>>((a, p) => { const g = p.split('.')[0]!; (a[g] ??= []).push(p); return a }, {})
  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th className="sticky left-0 bg-slate-50">Permission</th>{roles.data?.map((r) => <th key={r.id} className="text-center whitespace-nowrap">{titleCase(r.name)}</th>)}</tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([g, ps]) => (
              <Fragment key={g}>
                <tr><td colSpan={(roles.data?.length ?? 0) + 1} className="bg-slate-50/50 text-xs font-semibold tracking-wide text-slate-400 uppercase">{titleCase(g)}</td></tr>
                {ps.map((p) => (
                  <tr key={p}>
                    <td className="sticky left-0 bg-white font-mono text-xs text-slate-600">{p}</td>
                    {roles.data?.map((r) => <td key={r.id} className="text-center">{r.permissions.includes(p) ? <Check className="mx-auto size-4 text-emerald-600" /> : <span className="text-slate-200">·</span>}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><ShieldCheck className="size-4" /> Parent and student roles see only their own children / themselves through the portal.</div>
    </Card>
  )
}

/* ───── Security log ───── */
export function SecurityPage() {
  const [severity, setSeverity] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery({ queryKey: ['security-events', severity, type, page], queryFn: () => get<Page<SecurityEvent>>('/users/security-events', { severity, type, page, pageSize: 50 }), placeholderData: keepPreviousData })
  const TYPES = ['login_success', 'login_failed', 'account_locked', 'logout', 'password_changed', 'password_change_failed', 'password_reset', 'refresh_reuse', 'roles_changed', 'privilege_escalation_blocked', 'account_created', 'account_deactivated', 'account_reactivated', 'api_key_rejected', 'api_key_ip_blocked', 'result_lookup_throttled']
  return (
    <>
      <PageHeader title="Security log" subtitle="Sign-ins, password changes, role changes and blocked attempts." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Select className="w-48" value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} placeholder="All events" options={TYPES.map((t) => ({ value: t, label: titleCase(t) }))} />
          <Select className="w-40" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1) }} placeholder="All severities" options={['info', 'warning', 'critical'].map((s) => ({ value: s, label: titleCase(s) }))} />
        </div>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? <Empty title="No events" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>When</th><th>Event</th><th>User</th><th>By</th><th>IP</th><th>Details</th></tr></thead>
              <tbody>
                {list.data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(e.occurredAt)}</td>
                    <td><span className="flex items-center gap-2"><Badge tone={e.severity === 'critical' ? 'red' : e.severity === 'warning' ? 'amber' : 'blue'}>{e.severity}</Badge>{titleCase(e.eventType)}</span></td>
                    <td className="font-medium">{e.targetUsername ?? e.attemptedUsername ?? '—'}</td>
                    <td className="text-slate-500">{e.actorUsername && e.actorUsername !== e.targetUsername ? e.actorUsername : ''}</td>
                    <td className="font-mono text-xs text-slate-500">{e.ipAddress ?? '—'}</td>
                    <td className="max-w-xs truncate text-xs text-slate-500" title={JSON.stringify(e.details)}>{Object.entries(e.details ?? {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </Card>
    </>
  )
}
