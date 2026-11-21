import { CalendarCheck, Eye, EyeOff, LogIn, Receipt, Sparkles, Trophy } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { SchoolLogo } from '../components/SchoolLogo'
import { Button, ErrorBox, Field, Input } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useBranding, type DemoAccount } from '../lib/school'

const YEAR = new Date().getFullYear()

const FEATURES = [
  { icon: <CalendarCheck className="size-4" />, text: 'Daily attendance with instant summaries' },
  { icon: <Trophy className="size-4" />, text: 'Exams, NEB grading and printable report cards' },
  { icon: <Receipt className="size-4" />, text: 'Fees, receipts and statements for every family' },
]

export function LoginPage() {
  const { login } = useAuth()
  const { data: brand } = useBranding()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const name = brand?.configured ? brand.name : 'School Portal'

  async function signIn(u: string, p: string, who: string) {
    setBusy(who)
    setError(null)
    try {
      await login(u.trim(), p)
    } catch (err) {
      setError(err)
      setPassword('')
    } finally {
      setBusy(null)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void signIn(username, password, 'form')
  }
  const demo = (a: DemoAccount) => {
    setUsername(a.username)
    setPassword(a.password)
    void signIn(a.username, a.password, a.username)
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-600 lg:block">
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-white/10" />
        <div className="absolute -right-32 -bottom-32 size-[28rem] rounded-full bg-white/5" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-white p-1 shadow-sm">
              <SchoolLogo size="md" />
            </div>
            <div>
              <div className="text-lg leading-tight font-semibold">{name}</div>
              {brand?.nameNp && <div className="text-sm text-brand-100">{brand.nameNp}</div>}
            </div>
          </div>
          <div>
            <h2 className="max-w-md text-3xl leading-tight font-semibold">Everything your school runs on, in one simple place.</h2>
            <ul className="mt-6 space-y-3">
              {FEATURES.map((f) => (
                <li key={f.text} className="flex items-center gap-3 text-brand-50">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">{f.icon}</span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-xs text-brand-200">© {YEAR} {name}</div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <form onSubmit={submit}>
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <SchoolLogo size="md" />
              <div>
                <div className="leading-tight font-semibold text-slate-900">{name}</div>
                {brand?.nameNp && <div className="text-sm text-slate-500">{brand.nameNp}</div>}
              </div>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
            <p className="mt-1 text-sm text-slate-500">Use the username and password given by the school office.</p>

            <div className="mt-8 space-y-4">
              <Field label="Username">
                <Input autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={50} />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} className="pr-10" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-2 right-2.5 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </Field>
              <ErrorBox error={error} />
              <Button type="submit" loading={busy === 'form'} disabled={!!busy} className="w-full py-2.5">
                Sign in
              </Button>
            </div>
            <p className="mt-6 text-center text-xs text-slate-400">Forgot your password? Ask the school office to reset it.</p>
          </form>

          {!!brand?.demoAccounts?.length && (
            <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <Sparkles className="size-4" /> Demo — try any role
              </div>
              <p className="mt-0.5 text-xs text-amber-800">Sample data. Every account uses the password <code className="font-mono font-semibold">{brand.demoAccounts[0]!.password}</code></p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {brand.demoAccounts.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    disabled={!!busy}
                    onClick={() => demo(a)}
                    className="group flex items-center justify-between rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-sm transition hover:border-amber-400 hover:shadow-xs disabled:opacity-60"
                  >
                    <span>
                      <span className="block font-medium text-slate-800">{a.role}</span>
                      <span className="block font-mono text-[11px] text-slate-500">{a.username}</span>
                    </span>
                    <LogIn className={busy === a.username ? 'size-4 animate-pulse text-amber-600' : 'size-4 text-slate-300 group-hover:text-amber-600'} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
