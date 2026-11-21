import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, Phone, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Empty, ErrorBox, Pagination, PageHeader, Spinner } from '../../components/ui'
import { get, type Page } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { initials, titleCase } from '../../lib/format'
import { keepPreviousData, useDebounced } from '../../lib/hooks'
import type { GuardianListRow } from '../../lib/types'
import { AccountModal } from '../../components/AccountModal'
import { GuardianEditModal } from './GuardianEditModal'

/** Directory of parents & guardians: find a parent by name or phone, see their children, fix contact details, give portal access. */
export function GuardiansPage() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const manage = can('students.manage')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<number | null>(null)
  const [loginFor, setLoginFor] = useState<GuardianListRow | null>(null)
  const q = useDebounced(search.trim())

  const { data, isLoading, error } = useQuery({
    queryKey: ['guardians', q, page],
    queryFn: () => get<Page<GuardianListRow>>('/guardians', { search: q, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <PageHeader title="Parents & guardians" subtitle={data ? `${data.total} guardian${data.total === 1 ? '' : 's'}${q ? ' found' : ''}` : undefined} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <input className="input pl-9" placeholder="Search by name or phone number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
          </div>
        </div>
        <ErrorBox error={error} className="m-4" />
        {isLoading ? (
          <Spinner />
        ) : !data?.items.length ? (
          <Empty title={q ? 'No guardian matches' : 'No guardians yet'} hint={q ? 'Try part of the name or the last digits of the phone.' : 'Guardians are added from a student’s profile → Guardians.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Guardian</th><th>Phone</th><th>Children</th><th>Portal login</th>{manage && <th className="text-right">Actions</th>}</tr>
              </thead>
              <tbody>
                {data.items.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initials(g.fullName)}</div>
                        <div>
                          <div className="font-medium text-slate-900">{g.fullName}</div>
                          {(g.occupation || g.email) && <div className="text-xs text-slate-500">{[g.occupation, g.email].filter(Boolean).join(' · ')}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <a href={`tel:${g.phone}`} className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-700 hover:text-brand-600">
                        <Phone className="size-3.5 text-slate-400" /> {g.phone}
                      </a>
                    </td>
                    <td>
                      {g.children.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {g.children.map((c) => (
                            <Link key={c.studentId} to={`/students/${c.studentId}`} className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-brand-700 hover:bg-brand-100" title={`${titleCase(c.relation)} of ${c.name} (${c.admissionNo})`}>
                              {c.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{g.userId ? <Badge tone="green">Active</Badge> : <Badge>None</Badge>}</td>
                    {manage && (
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {!g.userId && (
                            <Button size="sm" variant="secondary" icon={<KeyRound className="size-3.5" />} onClick={() => setLoginFor(g)}>
                              Create login
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(g.id)}>
                            Edit
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      {editing && <GuardianEditModal guardianId={editing} onClose={() => setEditing(null)} />}
      {loginFor && (
        <AccountModal
          path={`/guardians/${loginFor.id}/account`}
          title={`Parent login for ${loginFor.fullName}`}
          suggested={loginFor.phone.replace(/[^0-9]/g, '')}
          onClose={() => setLoginFor(null)}
          onDone={() => void qc.invalidateQueries({ queryKey: ['guardians'] })}
        />
      )}
    </>
  )
}
