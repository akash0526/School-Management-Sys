import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { get, type Page } from '../lib/api'
import { fullName } from '../lib/format'
import { useDebounced } from '../lib/hooks'
import type { StudentRow } from '../lib/types'

/** Type-ahead search over /students. */
export function StudentPicker({ value, onChange, placeholder = 'Search by name or admission no…' }: { value: StudentRow | null; onChange: (s: StudentRow | null) => void; placeholder?: string }) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const q = useDebounced(term.trim())
  const { data, isFetching } = useQuery({
    queryKey: ['student-search', q],
    queryFn: () => get<Page<StudentRow>>('/students', { search: q, pageSize: 8, status: 'active' }),
    enabled: q.length >= 2,
  })

  if (value)
    return (
      <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
        <div>
          <div className="font-medium text-slate-900">{fullName(value)}</div>
          <div className="text-xs text-slate-500">
            {value.admissionNo}
            {value.className ? ` · ${value.className} ${value.sectionName ?? ''}` : ' · not enrolled'}
          </div>
        </div>
        <button className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600" onClick={() => onChange(null)} aria-label="Clear">
          <X className="size-4" />
        </button>
      </div>
    )

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
      <input
        className="input pl-9"
        placeholder={placeholder}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && q.length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {isFetching && !data && <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>}
          {data?.items.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No students found</div>}
          {data?.items.map((s) => (
            <button
              key={s.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s)
                setTerm('')
                setOpen(false)
              }}
            >
              <div className="font-medium text-slate-900">{fullName(s)}</div>
              <div className="text-xs text-slate-500">
                {s.admissionNo}
                {s.className ? ` · ${s.className} ${s.sectionName ?? ''}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
