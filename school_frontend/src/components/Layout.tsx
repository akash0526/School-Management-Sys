import {
  BookOpen,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  Home,
  KeyRound,
  LogOut,
  Menu,
  Receipt,
  School,
  Settings,
  Contact,
  ShieldAlert,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react'
import { Suspense, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useBranding } from '../lib/school'
import { ErrorBoundary } from './ErrorBoundary'
import { SchoolLogo } from './SchoolLogo'
import { initials, titleCase } from '../lib/format'
import { Spinner } from './ui'
import { cx } from './ui-utils'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  /** visible if the user has ANY of these; empty = everyone */
  perms?: string[]
  family?: boolean
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const ic = 'size-[18px]'
const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <Home className={ic} /> },
      { to: '/portal', label: 'My children', icon: <UsersRound className={ic} />, family: true },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/students', label: 'Students', icon: <GraduationCap className={ic} />, perms: ['students.view'] },
      { to: '/guardians', label: 'Parents & guardians', icon: <Contact className={ic} />, perms: ['students.view'] },
      { to: '/staff', label: 'Staff', icon: <Users className={ic} />, perms: ['staff.view'] },
    ],
  },
  {
    label: 'Academics',
    items: [
      { to: '/academic', label: 'Academic setup', icon: <School className={ic} />, perms: ['academic.manage'] },
      { to: '/enrollment', label: 'Enrollment', icon: <ClipboardList className={ic} />, perms: ['enrollment.manage'] },
      { to: '/attendance', label: 'Attendance', icon: <CalendarCheck className={ic} />, perms: ['attendance.mark', 'attendance.mark_any', 'attendance.view'] },
      { to: '/exams', label: 'Exams & results', icon: <BookOpen className={ic} />, perms: ['exams.manage', 'marks.enter', 'marks.enter_any', 'marks.approve', 'results.view'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/fees', label: 'Fees', icon: <Wallet className={ic} />, perms: ['fees.view', 'fees.manage'] },
      { to: '/fees/collect', label: 'Collect payment', icon: <Receipt className={ic} />, perms: ['fees.collect'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users & roles', icon: <UserCog className={ic} />, perms: ['users.manage'] },
      { to: '/security', label: 'Security log', icon: <ShieldAlert className={ic} />, perms: ['users.manage'] },
      { to: '/settings', label: 'School settings', icon: <Settings className={ic} />, perms: ['settings.manage'] },
    ],
  },
]

export function Layout() {
  const { user, can, isFamily, logout } = useAuth()
  const { data: brand } = useBranding()
  const schoolName = brand?.configured ? brand.name : 'School Portal'
  const [open, setOpen] = useState(false)
  const loc = useLocation()

  const visible = (i: NavItem) => (i.family ? isFamily : !i.perms || can(...i.perms))
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length)
  const familyLabel = user?.studentId ? 'My school' : 'My children'

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <SchoolLogo />
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm leading-tight font-semibold text-slate-900" title={schoolName}>{schoolName}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">School portal</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === '/' || i.to === '/fees'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )
                  }
                >
                  {i.icon}
                  {i.family ? familyLabel : i.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{initials(user?.username ?? '?')}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">{user?.username}</div>
            <div className="truncate text-xs text-slate-500">{user?.roles.map(titleCase).join(', ') || 'User'}</div>
          </div>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <NavLink to="/account" onClick={() => setOpen(false)} className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
            <KeyRound className="size-3.5" /> My account
          </NavLink>
          <button onClick={() => void logout()} className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-full">
      {/* desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button className="absolute top-5 right-3 rounded p-1 text-slate-400" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <SchoolLogo size="sm" className="!size-7" />
          <span className="truncate text-sm font-semibold">{schoolName}</span>
        </header>
        <main key={loc.pathname} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <ErrorBoundary key={loc.pathname}>
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
