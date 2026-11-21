import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CalendarCheck, CalendarDays, CheckCircle2, Circle, GraduationCap, HandCoins, Receipt, Rocket, Users, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, Empty, PageHeader, Stat } from '../components/ui'
import { cx } from '../components/ui-utils'
import { get, type Items, type Page } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, money } from '../lib/format'
import { sectionLabel, useClassSubjects, useCurrentYear, useMyStaff, useSections } from '../lib/hooks'
import { useBranding } from '../lib/school'
import type { Assignment, CalendarEntry, Exam, FeesSummary, Staff, StudentRow } from '../lib/types'
import { MyChildren } from './portal/Portal'

function greeting(now: Date) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function DashboardPage() {
  const { user, isFamily } = useAuth()
  const [now] = useState(() => new Date())
  if (isFamily) return <MyChildren greeting={`${greeting(now)}, ${user?.username}`} />
  return <StaffDashboard now={now} />
}

function StaffDashboard({ now }: { now: Date }) {
  const { user, can } = useAuth()
  const year = useCurrentYear().data
  const me = useMyStaff(user?.staffId).data
  const students = useQuery({ queryKey: ['dash-students'], queryFn: () => get<Page<StudentRow>>('/students', { pageSize: 1, status: 'active' }), enabled: can('students.view') })
  const staff = useQuery({ queryKey: ['dash-staff'], queryFn: () => get<Page<Staff>>('/staff', { pageSize: 1, status: 'active' }), enabled: can('staff.view') })
  const fees = useQuery({ queryKey: ['fees-summary'], queryFn: () => get<FeesSummary>('/fees/summary'), enabled: can('fees.view') })
  const exams = useQuery({ queryKey: ['exams', year?.id], queryFn: () => get<Items<Exam>>('/exams', { academicYearId: year?.id }), enabled: !!year && can('exams.manage', 'marks.enter', 'marks.enter_any', 'marks.approve', 'results.view') })
  const calendar = useQuery({ queryKey: ['calendar', year?.id], queryFn: () => get<Items<CalendarEntry>>('/academic/calendar', { academicYearId: year?.id }), enabled: !!year })
  const assignments = useQuery({
    queryKey: ['my-assignments', user?.staffId, year?.id],
    queryFn: () => get<Items<Assignment>>('/academic/teacher-assignments', { staffId: user?.staffId ?? undefined, academicYearId: year?.id }),
    enabled: !!user?.staffId && !!year,
  })
  const sections = useSections(year?.id)
  const myClassSections = (sections.data ?? []).filter((s) => user?.staffId && s.classTeacherId === user.staffId)

  const today = now.toISOString().slice(0, 10)
  const upcoming = (calendar.data?.items ?? []).filter((c) => c.endDate >= today).slice(0, 5)
  const f = fees.data

  const actions: { to: string; label: string; icon: ReactNode; show: boolean }[] = [
    { to: '/attendance', label: 'Mark attendance', icon: <CalendarCheck className="size-5" />, show: can('attendance.mark', 'attendance.mark_any') },
    { to: '/exams', label: 'Enter marks', icon: <BookOpen className="size-5" />, show: can('marks.enter', 'marks.enter_any') },
    { to: '/fees/collect', label: 'Collect payment', icon: <Receipt className="size-5" />, show: can('fees.collect') },
    { to: '/students?new=1', label: 'Admit student', icon: <GraduationCap className="size-5" />, show: can('students.manage') },
  ]

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${me?.firstName ?? user?.username}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {year && <Badge tone="indigo">Academic year {year.name}</Badge>}
          </span>
        }
      />

      <GettingStarted yearId={year?.id} studentCount={students.data?.total} staffCount={staff.data?.total} sectionCount={sections.data?.length} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can('students.view') && <Stat label="Active students" value={students.data?.total ?? '—'} icon={<GraduationCap className="size-5" />} />}
        {can('staff.view') && <Stat label="Active staff" value={staff.data?.total ?? '—'} icon={<Users className="size-5" />} tone="sky" />}
        {can('fees.view') && (
          <Stat
            label="Outstanding dues"
            value={f ? money(f.outstandingAmount) : '—'}
            icon={<Wallet className="size-5" />}
            tone="rose"
            hint={f && (f.overdueInvoices ? `${money(f.overdueAmount)} overdue · ${f.studentsWithDues} students` : `${f.openInvoices} open invoices`)}
          />
        )}
        {can('fees.view') && (
          <Stat
            label="Collected today"
            value={f ? money(f.collectedToday) : '—'}
            icon={<HandCoins className="size-5" />}
            tone="emerald"
            hint={f && `${f.receiptsToday} receipt${f.receiptsToday === 1 ? '' : 's'} · ${money(f.collectedLast30Days)} in 30 days`}
          />
        )}
        {!can('students.view', 'staff.view', 'fees.view') && year && <Stat label="Academic year" value={year.name} icon={<CalendarDays className="size-5" />} />}
      </div>

      {actions.some((a) => a.show) && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions
            .filter((a) => a.show)
            .map((a) => (
              <Link key={a.to} to={a.to} className="card group flex items-center gap-3 p-4 transition hover:border-brand-200 hover:shadow-sm">
                <div className="flex size-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-600">{a.icon}</div>
                <span className="flex-1 text-sm font-medium text-slate-800">{a.label}</span>
                <ArrowRight className="size-4 text-slate-300 group-hover:text-brand-500" />
              </Link>
            ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {user?.staffId && (
          <Card title="My classes" className="lg:col-span-2" padded={false}>
            {myClassSections.length === 0 && (assignments.data?.items.length ?? 0) === 0 ? (
              <Empty title="No classes assigned" hint="Your subject and class-teacher assignments for this year will show here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {myClassSections.map((s) => (
                  <li key={`ct-${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{sectionLabel(s)}</div>
                      <div className="text-xs text-slate-500">Class teacher · {s.studentCount} students</div>
                    </div>
                    <Link to={`/attendance?section=${s.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                      Attendance →
                    </Link>
                  </li>
                ))}
                {assignments.data?.items.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{a.subjectName}</div>
                      <div className="text-xs text-slate-500">
                        {a.className} – {a.sectionName}
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <Link to={`/attendance?section=${a.sectionId}`} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                        Attendance
                      </Link>
                      <Link to="/exams" className="text-sm font-medium text-brand-600 hover:text-brand-700">
                        Marks →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {exams.data && (
          <Card title="Exams this year" padded={false} className={user?.staffId ? '' : 'lg:col-span-2'} actions={<Link to="/exams" className="text-xs font-medium text-brand-600">View all</Link>}>
            {exams.data.items.length === 0 ? (
              <Empty title="No exams yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {exams.data.items.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    <Link to={`/exams/${e.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{e.name}</div>
                        <div className="text-xs text-slate-500">{e.startDate ? date(e.startDate) : 'No date set'}</div>
                      </div>
                      {e.isPublished ? <Badge tone="green">Published</Badge> : <Badge>Draft</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Upcoming on the calendar" padded={false}>
          {upcoming.length === 0 ? (
            <Empty title="Nothing scheduled" hint="Holidays, exams and events added in Academic setup appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-12 shrink-0 rounded-lg bg-slate-100 py-1 text-center">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">{new Date(`${c.startDate}T00:00`).toLocaleString('en', { month: 'short' })}</div>
                    <div className="text-base leading-tight font-semibold text-slate-800">{new Date(`${c.startDate}T00:00`).getDate()}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{c.title}</div>
                    <div className="text-xs text-slate-500 capitalize">
                      {c.startDate <= today ? 'Now · ' : ''}
                      {c.dayType.replace('_', ' ')}
                      {c.endDate !== c.startDate && ` · until ${date(c.endDate)}`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

/** First-run checklist for administrators. Disappears once the school is set up. */
function GettingStarted({ yearId, studentCount, staffCount, sectionCount }: { yearId?: number; studentCount?: number; staffCount?: number; sectionCount?: number }) {
  const { can } = useAuth()
  const brand = useBranding().data
  const admin = can('settings.manage', 'academic.manage')
  const subjects = useClassSubjects(admin ? yearId : undefined)
  const structures = useQuery({
    queryKey: ['fee-structures', yearId],
    queryFn: () => get<Items<unknown>>('/fees/structures', { academicYearId: yearId }),
    enabled: admin && !!yearId && can('fees.view'),
  })
  if (!admin || !brand || sectionCount === undefined || subjects.data === undefined) return null

  const steps = [
    { done: brand.configured, label: 'School profile & logo', hint: 'Name, address and PAN appear on receipts and report cards.', to: '/settings', show: can('settings.manage') },
    { done: sectionCount > 0, label: 'Classes & sections', hint: 'Create the sections for this academic year.', to: '/academic', show: can('academic.manage') },
    { done: subjects.data.length > 0, label: 'Subjects for each class', hint: 'Add the curriculum, then assign teachers.', to: '/academic', show: can('academic.manage') },
    { done: (staffCount ?? 0) > 0, label: 'Staff & logins', hint: 'Add teachers and give them a login.', to: '/staff', show: can('staff.view') },
    { done: (studentCount ?? 0) > 0, label: 'Admit & enroll students', hint: 'Admit students, add guardians, enroll them in sections.', to: '/students', show: can('students.view') },
    { done: (structures.data?.items.length ?? 0) > 0, label: 'Fee structure', hint: 'Set monthly, term and yearly fees per class.', to: '/fees', show: can('fees.view') && structures.data !== undefined },
  ].filter((s) => s.show)
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null

  return (
    <Card className="mb-6 border-brand-200 bg-gradient-to-br from-brand-50/70 to-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Rocket className="size-5" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">Set up your school</div>
            <div className="text-sm text-slate-500">
              {done} of {steps.length} done — finish these and the portal is ready for staff and parents.
            </div>
          </div>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link to={s.to} className={cx('flex h-full items-start gap-3 rounded-lg border bg-white p-3 transition hover:shadow-xs', s.done ? 'border-emerald-200' : 'border-slate-200 hover:border-brand-300')}>
              {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-5 shrink-0 text-slate-300" />}
              <span>
                <span className={cx('block text-sm font-medium', s.done ? 'text-slate-500 line-through' : 'text-slate-900')}>
                  {i + 1}. {s.label}
                </span>
                {!s.done && <span className="block text-xs text-slate-500">{s.hint}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  )
}
