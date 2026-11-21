import { lazy, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Card, Empty, Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import { useDocumentBranding } from './lib/school'
import { AccountPage, ForcedPasswordChange } from './pages/ChangePassword'
import { DashboardPage } from './pages/Dashboard'
import { LoginPage } from './pages/Login'
import { ChildPage, MyChildren } from './pages/portal/Portal'

const AcademicPage = lazy(() => import('./pages/academic/AcademicPage').then((m) => ({ default: m.AcademicPage })))
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })))
const EnrollmentPage = lazy(() => import('./pages/enrollment/EnrollmentPage').then((m) => ({ default: m.EnrollmentPage })))
const ExamDetailPage = lazy(() => import('./pages/exams/ExamDetailPage').then((m) => ({ default: m.ExamDetailPage })))
const ExamsPage = lazy(() => import('./pages/exams/ExamsPage').then((m) => ({ default: m.ExamsPage })))
const ReportCardPage = lazy(() => import('./pages/exams/ReportCardPage').then((m) => ({ default: m.ReportCardPage })))
const CollectPage = lazy(() => import('./pages/fees/CollectPage').then((m) => ({ default: m.CollectPage })))
const FeesPage = lazy(() => import('./pages/fees/FeesPage').then((m) => ({ default: m.FeesPage })))
const ReceiptPage = lazy(() => import('./pages/fees/ReceiptPage').then((m) => ({ default: m.ReceiptPage })))
const StaffPage = lazy(() => import('./pages/staff/StaffPage').then((m) => ({ default: m.StaffPage })))
const StudentDetailPage = lazy(() => import('./pages/students/StudentDetailPage').then((m) => ({ default: m.StudentDetailPage })))
const StudentsPage = lazy(() => import('./pages/students/StudentsPage').then((m) => ({ default: m.StudentsPage })))
const GuardiansPage = lazy(() => import('./pages/guardians/GuardiansPage').then((m) => ({ default: m.GuardiansPage })))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const UsersPage = lazy(() => import('./pages/users/UsersPage').then((m) => ({ default: m.UsersPage })))
const SecurityPage = lazy(() => import('./pages/users/UsersPage').then((m) => ({ default: m.SecurityPage })))

/** Hides a page unless the user holds ANY of the permissions. The API enforces the same rules. */
function Need({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth()
  if (can(...perms)) return <>{children}</>
  return (
    <Card>
      <Empty title="You don't have access to this page" hint="Ask an administrator if you need it." action={<Link to="/" className="text-sm font-medium text-brand-600">Go to dashboard</Link>} />
    </Card>
  )
}

function FamilyOnly({ children }: { children: ReactNode }) {
  const { isFamily } = useAuth()
  return isFamily ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  const { user, loading } = useAuth()
  useDocumentBranding()

  if (loading) return <div className="flex h-full items-center justify-center"><Spinner label="Loading…" /></div>
  if (!user) return <LoginPage />
  if (user.mustChangePassword) return <ForcedPasswordChange />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="account" element={<AccountPage />} />

        <Route path="portal" element={<FamilyOnly><MyChildren /></FamilyOnly>} />
        <Route path="portal/:studentId" element={<FamilyOnly><ChildPage /></FamilyOnly>} />
        <Route path="report-card/:examId/:studentId" element={<ReportCardPage />} />

        <Route path="students" element={<Need perms={['students.view']}><StudentsPage /></Need>} />
        <Route path="students/:id" element={<Need perms={['students.view']}><StudentDetailPage /></Need>} />
        <Route path="guardians" element={<Need perms={['students.view']}><GuardiansPage /></Need>} />
        <Route path="staff" element={<Need perms={['staff.view']}><StaffPage /></Need>} />

        <Route path="academic" element={<Need perms={['academic.manage']}><AcademicPage /></Need>} />
        <Route path="enrollment" element={<Need perms={['enrollment.manage']}><EnrollmentPage /></Need>} />
        <Route path="attendance" element={<Need perms={['attendance.mark', 'attendance.mark_any', 'attendance.view']}><AttendancePage /></Need>} />
        <Route path="exams" element={<Need perms={['exams.manage', 'marks.enter', 'marks.enter_any', 'marks.approve', 'results.view']}><ExamsPage /></Need>} />
        <Route path="exams/:id" element={<Need perms={['exams.manage', 'marks.enter', 'marks.enter_any', 'marks.approve', 'results.view']}><ExamDetailPage /></Need>} />

        <Route path="fees" element={<Need perms={['fees.view', 'fees.manage']}><FeesPage /></Need>} />
        <Route path="fees/collect" element={<Need perms={['fees.collect']}><CollectPage /></Need>} />
        <Route path="fees/receipts/:id" element={<Need perms={['fees.view', 'fees.collect']}><ReceiptPage /></Need>} />

        <Route path="users" element={<Need perms={['users.manage']}><UsersPage /></Need>} />
        <Route path="security" element={<Need perms={['users.manage']}><SecurityPage /></Need>} />
        <Route path="settings" element={<Need perms={['settings.manage']}><SettingsPage /></Need>} />

        <Route path="*" element={<Card><Empty title="Page not found" action={<Link to="/" className="text-sm font-medium text-brand-600">Go to dashboard</Link>} /></Card>} />
      </Route>
    </Routes>
  )
}
