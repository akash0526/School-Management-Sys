import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, Tabs } from '../../components/ui'
import { cx, useToast } from '../../components/ui-utils'
import { get, put, type Items } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { today } from '../../lib/format'
import { sectionLabel, useCurrentYear, useSections } from '../../lib/hooks'
import type { Assignment, RosterRow, StaffAttendanceRow } from '../../lib/types'

const STATUSES = [
  { id: 'present', short: 'P', on: 'bg-emerald-600 text-white border-emerald-600' },
  { id: 'absent', short: 'A', on: 'bg-rose-600 text-white border-rose-600' },
  { id: 'late', short: 'L', on: 'bg-amber-500 text-white border-amber-500' },
  { id: 'leave', short: 'Lv', on: 'bg-sky-600 text-white border-sky-600' },
  { id: 'half_day', short: 'H', on: 'bg-violet-600 text-white border-violet-600' },
] as const

function StatusPicker({ value, onChange, disabled }: { value: string | null; onChange: (s: string) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex gap-1">
      {STATUSES.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={disabled}
          title={s.id.replace('_', ' ')}
          onClick={() => onChange(s.id)}
          className={cx('h-8 min-w-9 rounded-md border px-2 text-xs font-semibold transition-colors disabled:opacity-50', value === s.id ? s.on : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50')}
        >
          {s.short}
        </button>
      ))}
    </div>
  )
}

type Tab = 'students' | 'staff'

export function AttendancePage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('students')
  const staffTab = can('attendance.mark_any', 'attendance.view')
  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily attendance for students and staff." />
      {staffTab && <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'students', label: 'Students' }, { id: 'staff', label: 'Staff' }]} />}
      {tab === 'students' ? <StudentAttendance /> : <StaffAttendance />}
    </>
  )
}

function StudentAttendance() {
  const { user, can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const year = useCurrentYear().data
  const sections = useSections(year?.id)
  const anySection = can('attendance.mark_any', 'attendance.view')
  const mine = useQuery({
    queryKey: ['my-assignments', user?.staffId, year?.id],
    queryFn: () => get<Items<Assignment>>('/academic/teacher-assignments', { staffId: user?.staffId ?? undefined, academicYearId: year?.id }),
    enabled: !anySection && !!user?.staffId && !!year,
  })
  const allowed = useMemo(() => {
    const all = sections.data ?? []
    if (anySection) return all
    const ids = new Set((mine.data?.items ?? []).map((a) => a.sectionId))
    return all.filter((s) => ids.has(s.id) || (user?.staffId && s.classTeacherId === user.staffId))
  }, [sections.data, mine.data, anySection, user?.staffId])

  const [sectionId, setSectionId] = useState(params.get('section') ?? '')
  const [d, setD] = useState(today())
  const [allowHoliday, setAllowHoliday] = useState(false)
  const [rows, setRows] = useState<RosterRow[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!sectionId && allowed.length === 1) setSectionId(String(allowed[0]!.id))
  }, [allowed, sectionId])

  const roster = useQuery({
    queryKey: ['roster', sectionId, d],
    queryFn: () => get<Items<RosterRow>>(`/attendance/sections/${sectionId}`, { date: d }),
    enabled: !!sectionId && !!d,
  })
  useEffect(() => {
    if (roster.data) { setRows(roster.data.items); setDirty(false) }
  }, [roster.data])

  const save = useMutation({
    mutationFn: () => put(`/attendance/sections/${sectionId}`, { date: d, ...(allowHoliday ? { allowHoliday: true } : {}), records: rows.filter((r) => r.status).map((r) => ({ enrollmentId: r.enrollmentId, status: r.status!, remarks: r.remarks || null })) }),
    onSuccess: () => { toast.success('Attendance saved'); setDirty(false); void qc.invalidateQueries({ queryKey: ['roster', sectionId, d] }) },
    onError: toast.error,
  })

  const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.status ?? 'unmarked'] = (a[r.status ?? 'unmarked'] ?? 0) + 1), a), {})
  const unmarked = counts.unmarked ?? 0
  const alreadyRecorded = roster.data?.items.some((r) => r.status)
  const setRow = (i: number, patch: Partial<RosterRow>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true) }
  const canMark = can('attendance.mark', 'attendance.mark_any')

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <Field label="Section" className="min-w-64 flex-1">
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)} placeholder={allowed.length ? 'Select a section' : 'No sections assigned to you'} options={allowed.map((s) => ({ value: s.id, label: `${sectionLabel(s)} · ${s.studentCount}` }))} />
        </Field>
        <Field label="Date" className="w-44"><Input type="date" value={d} max={today()} onChange={(e) => setD(e.target.value)} /></Field>
        {can('attendance.mark_any') && <div className="pb-2"><Checkbox label="Allow on holiday" checked={allowHoliday} onChange={setAllowHoliday} /></div>}
      </div>

      {!sectionId ? <Empty title="Choose a section" hint="You can mark attendance for sections you teach or are class teacher of." /> : roster.isLoading ? <Spinner /> : roster.error ? <ErrorBox error={roster.error} className="m-4" /> : !rows.length ? <Empty title="No students in this section" /> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {alreadyRecorded ? <Badge tone="green">Recorded</Badge> : <Badge tone="amber">Not yet taken</Badge>}
              {STATUSES.map((s) => counts[s.id] ? <span key={s.id} className="text-slate-600"><b>{counts[s.id]}</b> {s.id.replace('_', ' ')}</span> : null)}
              {unmarked > 0 && <span className="text-slate-400">{unmarked} unmarked</span>}
            </div>
            {canMark && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => { setRows((rs) => rs.map((r) => ({ ...r, status: r.status ?? 'present' }))); setDirty(true) }}>Mark rest present</Button>
                <Button size="sm" icon={<Save className="size-4" />} loading={save.isPending} disabled={!dirty || rows.every((r) => !r.status)} onClick={() => save.mutate()}>Save</Button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th className="w-16">Roll</th><th>Student</th><th>Status</th><th>Remarks</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.enrollmentId}>
                    <td className="font-medium text-slate-500">{r.rollNo ?? '—'}</td>
                    <td className="font-medium text-slate-900">{r.studentName}</td>
                    <td><StatusPicker value={r.status} disabled={!canMark} onChange={(s) => setRow(i, { status: s })} /></td>
                    <td><Input className="py-1.5" value={r.remarks ?? ''} disabled={!canMark} onChange={(e) => setRow(i, { remarks: e.target.value })} maxLength={255} placeholder="—" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dirty && <div className="border-t border-slate-100 px-4 py-3"><Notice tone="amber">You have unsaved changes{unmarked ? ` · ${unmarked} student(s) still unmarked and will be skipped` : ''}.</Notice></div>}
        </>
      )}
    </Card>
  )
}

function StaffAttendance() {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [d, setD] = useState(today())
  const [rows, setRows] = useState<StaffAttendanceRow[]>([])
  const [dirty, setDirty] = useState(false)
  const q = useQuery({ queryKey: ['staff-att', d], queryFn: () => get<Items<StaffAttendanceRow>>('/attendance/staff', { date: d }), enabled: can('attendance.view') })
  useEffect(() => { if (q.data) { setRows(q.data.items); setDirty(false) } }, [q.data])
  const canMark = can('attendance.mark_any')
  const save = useMutation({
    mutationFn: () => put('/attendance/staff', { date: d, records: rows.filter((r) => r.status).map((r) => ({ staffId: r.staffId, status: r.status!, checkIn: r.checkIn || null, checkOut: r.checkOut || null, remarks: r.remarks || null })) }),
    onSuccess: () => { toast.success('Staff attendance saved'); setDirty(false); void qc.invalidateQueries({ queryKey: ['staff-att', d] }) },
    onError: toast.error,
  })
  const setRow = (i: number, p: Partial<StaffAttendanceRow>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); setDirty(true) }
  if (!can('attendance.view')) return <Card><Empty title="You can't view staff attendance" /></Card>
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
        <Field label="Date" className="w-44"><Input type="date" value={d} max={today()} onChange={(e) => setD(e.target.value)} /></Field>
        {canMark && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => { setRows((rs) => rs.map((r) => ({ ...r, status: r.status ?? 'present' }))); setDirty(true) }}>Mark rest present</Button>
            <Button size="sm" icon={<Save className="size-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save</Button>
          </div>
        )}
      </div>
      {q.isLoading ? <Spinner /> : !rows.length ? <Empty title="No active staff" /> : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Staff</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Remarks</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.staffId}>
                  <td><div className="font-medium text-slate-900">{r.staffName}</div><div className="text-xs text-slate-500">{r.employeeNo} · {r.designation}</div></td>
                  <td><StatusPicker value={r.status} disabled={!canMark} onChange={(s) => setRow(i, { status: s })} /></td>
                  <td><Input type="time" className="w-28 py-1.5" value={r.checkIn?.slice(0, 5) ?? ''} disabled={!canMark} onChange={(e) => setRow(i, { checkIn: e.target.value })} /></td>
                  <td><Input type="time" className="w-28 py-1.5" value={r.checkOut?.slice(0, 5) ?? ''} disabled={!canMark} onChange={(e) => setRow(i, { checkOut: e.target.value })} /></td>
                  <td><Input className="py-1.5" value={r.remarks ?? ''} disabled={!canMark} onChange={(e) => setRow(i, { remarks: e.target.value })} maxLength={255} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
