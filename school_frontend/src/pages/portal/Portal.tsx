import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarCheck, ChevronRight, FileText, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, Card, DL, Empty, ErrorBox, Input, PageHeader, Spinner, Stat, StatusBadge, Tabs } from '../../components/ui'
import { get, type Items, type Page } from '../../lib/api'
import { useMyStudents } from '../../lib/hooks'
import { useAuth } from '../../lib/auth'
import { date, fullName, gpa, initials, money, pct, today } from '../../lib/format'
import type { AttendanceRecord, AttendanceSummary, InvoiceRow, Statement, StudentExamResult, StudentRow } from '../../lib/types'


export function MyChildren({ greeting }: { greeting?: string }) {
  const { user } = useAuth()
  const { data, isLoading, error } = useMyStudents()
  const isStudent = !!user?.studentId
  return (
    <>
      <PageHeader title={greeting ?? (isStudent ? 'My school' : 'My children')} subtitle={isStudent ? 'Your attendance, results and fees.' : 'Choose a child to see attendance, results and fees.'} />
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && data.length === 0 && <Card><Empty title="No students linked to this account" hint="Please contact the school office to link your children to your account." /></Card>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((s) => (
          <Link key={s.id} to={`/portal/${s.id}`} className="card group flex items-center gap-4 p-5 transition hover:border-brand-200 hover:shadow-sm">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">{initials(fullName(s))}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-900">{fullName(s)}</div>
              <div className="text-sm text-slate-500">{s.className ? `${s.className} – ${s.sectionName}` : 'Not enrolled this year'}</div>
              <div className="mt-1 text-xs text-slate-400">
                Adm. {s.admissionNo}
                {s.rollNo ? ` · Roll ${s.rollNo}` : ''}
              </div>
            </div>
            <ChevronRight className="size-5 text-slate-300 group-hover:text-brand-500" />
          </Link>
        ))}
      </div>
    </>
  )
}

type Tab = 'overview' | 'attendance' | 'results' | 'fees'

export function ChildPage() {
  const { studentId } = useParams()
  const id = Number(studentId)
  const mine = useMyStudents()
  const child = mine.data?.find((s) => s.id === id)
  const [tab, setTab] = useState<Tab>('overview')

  if (mine.isLoading) return <Spinner />
  if (!child) return <Card><Empty title="Student not found" action={<Link to="/portal" className="text-sm text-brand-600">Back</Link>} /></Card>

  return (
    <>
      <PageHeader
        back={
          (mine.data?.length ?? 0) > 1 ? (
            <Link to="/portal" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
              <ArrowLeft className="size-4" /> All children
            </Link>
          ) : undefined
        }
        title={fullName(child)}
        subtitle={`${child.className ? `${child.className} – ${child.sectionName}` : 'Not enrolled'} · Adm. ${child.admissionNo}${child.rollNo ? ` · Roll ${child.rollNo}` : ''}`}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'attendance', label: 'Attendance', icon: <CalendarCheck className="size-4" /> },
          { id: 'results', label: 'Results', icon: <FileText className="size-4" /> },
          { id: 'fees', label: 'Fees', icon: <Wallet className="size-4" /> },
        ]}
      />
      {tab === 'overview' && <Overview student={child} />}
      {tab === 'attendance' && <AttendanceTab studentId={id} />}
      {tab === 'results' && <ResultsTab studentId={id} />}
      {tab === 'fees' && <FeesTab studentId={id} />}
    </>
  )
}

function Overview({ student }: { student: StudentRow }) {
  const summary = useQuery({ queryKey: ['att-summary', student.id], queryFn: () => get<Items<AttendanceSummary>>(`/attendance/students/${student.id}/summary`) })
  const stmt = useQuery({ queryKey: ['statement', student.id], queryFn: () => get<Statement>(`/fees/students/${student.id}/statement`) })
  const results = useQuery({ queryKey: ['student-results', student.id], queryFn: () => get<Items<StudentExamResult>>(`/exams/students/${student.id}/results`) })
  const s = summary.data?.items[0]
  const rate = s && s.recordedDays ? ((s.presentDays + s.lateDays) / s.recordedDays) * 100 : null
  const latest = results.data?.items[0]
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Attendance this year" value={rate == null ? '—' : `${rate.toFixed(1)}%`} hint={s ? `${s.presentDays + s.lateDays} of ${s.recordedDays} days` : undefined} icon={<CalendarCheck className="size-5" />} tone="emerald" />
        <Stat label="Latest result" value={latest ? (latest.gpa != null ? `GPA ${gpa(latest.gpa)}` : latest.finalGrade ?? '—') : '—'} hint={latest?.examName} icon={<FileText className="size-5" />} />
        <Stat
          label="Fee balance"
          value={stmt.data ? money(Math.max(0, stmt.data.balance)) : '—'}
          hint={stmt.data && stmt.data.balance < 0 ? `Advance ${money(-stmt.data.balance)}` : stmt.data?.balance === 0 ? 'All paid' : 'Due'}
          icon={<Wallet className="size-5" />}
          tone={stmt.data && stmt.data.balance > 0 ? 'rose' : 'emerald'}
        />
      </div>
      <Card title="Student details">
        <DL items={[['Name', fullName(student)], ['Admission no.', student.admissionNo], ['Class', student.className ? `${student.className} – ${student.sectionName}` : null], ['Roll no.', student.rollNo], ['Date of birth', date(student.dob)], ['Status', <StatusBadge key="status" status={student.status} />]]} />
      </Card>
    </div>
  )
}

export function AttendanceTab({ studentId }: { studentId: number }) {
  const t = today()
  const [from, setFrom] = useState(`${t.slice(0, 8)}01`)
  const [to, setTo] = useState(t)
  const summary = useQuery({ queryKey: ['att-summary', studentId], queryFn: () => get<Items<AttendanceSummary>>(`/attendance/students/${studentId}/summary`) })
  const records = useQuery({ queryKey: ['att-records', studentId, from, to], queryFn: () => get<Items<AttendanceRecord>>(`/attendance/students/${studentId}`, { from, to }), enabled: !!from && !!to && from <= to })
  const counts = (records.data?.items ?? []).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})
  return (
    <div className="space-y-6">
      {summary.data?.items.length ? (
        <Card title="By academic year" padded={false}>
          <table className="table-base">
            <thead>
              <tr><th>Year</th><th>Present</th><th>Late</th><th>Absent</th><th>Leave</th><th>Recorded days</th></tr>
            </thead>
            <tbody>
              {summary.data.items.map((s) => (
                <tr key={s.academicYearId}><td className="font-medium">{s.academicYear}</td><td>{s.presentDays}</td><td>{s.lateDays}</td><td>{s.absentDays}</td><td>{s.leaveDays}</td><td>{s.recordedDays}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      <Card
        title="Daily record"
        padded={false}
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-auto py-1.5" />
            <span className="text-slate-400">–</span>
            <Input type="date" value={to} min={from} max={t} onChange={(e) => setTo(e.target.value)} className="w-auto py-1.5" />
          </div>
        }
      >
        {records.isLoading ? <Spinner /> : !records.data?.items.length ? <Empty title="No attendance recorded in this period" /> : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
              {Object.entries(counts).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5 text-sm"><StatusBadge status={k} /> {v}</span>
              ))}
            </div>
            <table className="table-base">
              <thead><tr><th>Date</th><th>Status</th><th>Remarks</th></tr></thead>
              <tbody>
                {records.data.items.map((r, i) => (
                  <tr key={i}><td>{date(r.attendanceDate)}</td><td><StatusBadge status={r.status} /></td><td className="text-slate-500">{r.remarks ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  )
}

export function ResultsTab({ studentId }: { studentId: number }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['student-results', studentId], queryFn: () => get<Items<StudentExamResult>>(`/exams/students/${studentId}/results`) })
  if (isLoading) return <Spinner />
  return (
    <Card padded={false}>
      <ErrorBox error={error} className="m-4" />
      {!data?.items.length ? (
        <Empty title="No results yet" hint="Results appear here once the school publishes them." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Exam</th><th>Class</th><th>Percentage</th><th>GPA</th><th>Grade</th><th>Rank</th><th></th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.examId}>
                  <td>
                    <div className="font-medium text-slate-900">{r.examName}</div>
                    <div className="text-xs text-slate-500">{r.academicYear}{!r.isPublished && ' · not published'}</div>
                  </td>
                  <td>{r.className} – {r.sectionName}</td>
                  <td>{r.resultStatus === 'withheld' ? <Badge tone="red">Withheld</Badge> : pct(r.percentage)}</td>
                  <td className="font-medium">{gpa(r.gpa)}</td>
                  <td>{r.finalGrade ?? '—'}</td>
                  <td>{r.rankInSection ?? '—'}</td>
                  <td className="text-right">
                    {r.resultStatus !== 'withheld' && (
                      <Link to={`/report-card/${r.examId}/${studentId}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">Report card →</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function FeesTab({ studentId }: { studentId: number }) {
  const stmt = useQuery({ queryKey: ['statement', studentId], queryFn: () => get<Statement>(`/fees/students/${studentId}/statement`) })
  const invoices = useQuery({ queryKey: ['student-invoices', studentId], queryFn: () => get<Page<InvoiceRow>>(`/fees/students/${studentId}/invoices`, { pageSize: 100 }) })
  if (stmt.isLoading) return <Spinner />
  const bal = stmt.data?.balance ?? 0
  return (
    <div className="space-y-6">
      <ErrorBox error={stmt.error ?? invoices.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={bal >= 0 ? 'Balance due' : 'Advance paid'} value={money(Math.abs(bal))} tone={bal > 0 ? 'rose' : 'emerald'} icon={<Wallet className="size-5" />} />
      </div>
      <Card title="Invoices" padded={false}>
        {!invoices.data?.items.length ? <Empty title="No invoices" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Invoice</th><th>Period</th><th>Issued</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="text-right">Due</th><th>Status</th></tr></thead>
              <tbody>
                {invoices.data.items.map((i) => (
                  <tr key={i.id}>
                    <td className="font-mono text-xs">{i.invoiceNo}</td><td>{i.billingPeriod}</td><td>{date(i.issueDate)}</td>
                    <td className="text-right">{money(i.totalAmount)}</td><td className="text-right">{money(i.paidAmount)}</td>
                    <td className="text-right font-medium">{money(i.dueAmount ?? i.totalAmount - i.paidAmount)}</td><td><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Statement" padded={false}>
        {!stmt.data?.entries.length ? <Empty title="No transactions yet" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Date</th><th>Description</th><th className="text-right">Charge</th><th className="text-right">Payment</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {stmt.data.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.entryDate)}</td>
                    <td><span className="capitalize">{e.entryType.replace('_', ' ')}</span>{e.remarks && <span className="text-slate-500"> · {e.remarks}</span>}</td>
                    <td className="text-right">{e.debit ? money(e.debit) : ''}</td>
                    <td className="text-right text-emerald-700">{e.credit ? money(e.credit) : ''}</td>
                    <td className="text-right font-medium">{money(e.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
