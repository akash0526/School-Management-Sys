import { Check, KeyRound, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Card, DL, ErrorBox, Field, Input, Notice, PageHeader, Spinner } from '../components/ui'
import { useToast } from '../components/ui-utils'
import { post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, fullName, titleCase } from '../lib/format'
import { useMyStaff } from '../lib/hooks'

/** Mirrors the API's policy so users get instant feedback; the API remains the authority. */
function rules(pw: string, username: string) {
  return [
    { ok: pw.length >= 10, text: 'At least 10 characters' },
    { ok: /\p{L}/u.test(pw), text: 'Contains a letter' },
    { ok: /\p{N}/u.test(pw), text: 'Contains a number' },
    { ok: !username || !pw.toLowerCase().includes(username.toLowerCase()), text: 'Does not contain your username' },
    { ok: new TextEncoder().encode(pw).length <= 72, text: 'Not too long (max 72 bytes)' },
  ]
}

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { user, acceptToken } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const isAdmin = !!user?.permissions.includes('users.manage')
  const checks = rules(next, user?.username ?? '')
  const valid = checks.every((c) => c.ok) && next === confirm && current.length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ accessToken: string }>('/auth/change-password', { currentPassword: current, newPassword: next })
      await acceptToken(r.accessToken)
      toast.success('Password changed')
      setCurrent('')
      setNext('')
      setConfirm('')
      onDone?.()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Current password">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="New password">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required maxLength={128} />
      </Field>
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.text} className={c.ok ? 'flex items-center gap-1.5 text-emerald-700' : 'flex items-center gap-1.5 text-slate-400'}>
            {c.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />} {c.text}
          </li>
        ))}
      </ul>
      <Field label="Confirm new password" error={confirm && confirm !== next ? 'Passwords do not match' : undefined}>
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <p className="text-xs text-slate-500">
        Avoid common words like “password” or the school name. Nepali letters and digits are allowed.
        {isAdmin && ' As an administrator, please use 12 or more characters.'}
      </p>
      <ErrorBox error={error} />
      <Button type="submit" loading={busy} disabled={!valid} className="w-full">
        Change password
      </Button>
    </form>
  )
}

/** Full-screen gate shown when the account must change its (temporary) password. */
export function ForcedPasswordChange() {
  const { user, logout } = useAuth()
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <KeyRound className="size-6" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Welcome, <span className="font-medium text-slate-700">{user?.username}</span>. You signed in with a temporary password. Choose your own to continue.
          </p>
        </div>
        <div className="card p-6">
          <ChangePasswordForm />
        </div>
        <button onClick={() => void logout()} className="mt-4 w-full text-center text-sm text-slate-500 hover:text-slate-700">
          Sign out
        </button>
      </div>
    </div>
  )
}

export function AccountPage() {
  const { user } = useAuth()
  return (
    <>
      <PageHeader title="My account" subtitle={`Signed in as ${user?.username}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        {user?.staffId ? <StaffProfileCard staffId={user.staffId} /> : null}
        <Card title="Sign-in">
          <DL
            items={[
              ['Username', <span key="u" className="font-mono">{user?.username}</span>],
              ['Roles', <span key="r" className="flex flex-wrap gap-1">{user?.roles.length ? user.roles.map((r) => <Badge key={r}>{titleCase(r)}</Badge>) : '—'}</span>],
            ]}
          />
        </Card>
        <Card title="Change password">
          <ChangePasswordForm />
        </Card>
        <Card title="About sessions">
          <div className="space-y-3 text-sm text-slate-600">
            <p>Changing your password signs you out on every other device.</p>
            <p>Sessions end automatically after a period of inactivity. Always sign out on shared computers.</p>
            <Notice tone="amber">The school will never ask for your password by phone or SMS.</Notice>
          </div>
        </Card>
      </div>
    </>
  )
}

/** Read-only: staff records are maintained by the office so payroll and certificates stay consistent. */
function StaffProfileCard({ staffId }: { staffId: number }) {
  const { data, isLoading, error } = useMyStaff(staffId)
  return (
    <Card title="My staff record">
      {isLoading ? <Spinner /> : error ? <ErrorBox error={error} /> : data && (
        <>
          <DL
            items={[
              ['Name', fullName(data)],
              ['Employee no.', <span key="e" className="font-mono">{data.employeeNo}</span>],
              ['Designation', data.designation],
              ['Department', data.departmentName ?? '—'],
              ['Phone', data.phone],
              ['Email', data.email ?? '—'],
              ['Joined', date(data.joinDate)],
              ['Employment', titleCase(data.employmentType)],
            ]}
          />
          <p className="mt-4 text-xs text-slate-500">Something wrong? Ask the school office to update your record.</p>
        </>
      )}
    </Card>
  )
}
