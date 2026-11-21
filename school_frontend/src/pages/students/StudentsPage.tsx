import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, Empty, ErrorBox, Pagination, PageHeader, Select, Spinner, StatusBadge } from '../../components/ui'
import { enumOptions, useToast } from '../../components/ui-utils'
import { get, type Page } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { fullName, initials, titleCase } from '../../lib/format'
import { keepPreviousData, useDebounced } from '../../lib/hooks'
import { STUDENT_STATUSES, type StudentRow } from '../../lib/types'
import { StudentFormModal } from './StudentForm'

export function StudentsPage() {
  const { can } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [page, setPage] = useState(1)
  const q = useDebounced(search.trim())
  const showNew = params.get('new') === '1'

  const { data, isLoading, error } = useQuery({
    queryKey: ['students', q, status, page],
    queryFn: () => get<Page<StudentRow>>('/students', { search: q, status, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={data ? `${data.total} ${status ? titleCase(status).toLowerCase() : ''} students` : undefined}
        actions={can('students.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: '1' })}>Admit student</Button>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search name, admission no. or phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <Select className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} placeholder="All statuses" options={enumOptions(STUDENT_STATUSES)} />
        </div>
        <ErrorBox error={error} className="m-4" />
        {isLoading ? <Spinner /> : !data?.items.length ? (
          <Empty title="No students found" hint={q ? 'Try a different search.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Student</th><th>Admission no.</th><th>Class</th><th>Roll</th><th>Gender</th><th>Phone</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => nav(`/students/${s.id}`)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{initials(fullName(s))}</div>
                        <span className="font-medium text-slate-900">{fullName(s)}</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-slate-600">{s.admissionNo}</td>
                    <td>{s.className ? `${s.className} – ${s.sectionName}` : <span className="text-slate-400">Not enrolled</span>}</td>
                    <td>{s.rollNo ?? '—'}</td>
                    <td className="capitalize">{s.gender}</td>
                    <td>{s.phone ?? '—'}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      {showNew && (
        <StudentFormModal
          open
          onClose={() => setParams({})}
          onSaved={(s) => {
            toast.success('Student admitted. Enroll them in a section next.')
            nav(`/students/${s.id}`)
          }}
        />
      )}
    </>
  )
}
