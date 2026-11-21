export const fullName = (p: { firstName: string; middleName?: string | null; lastName: string }) =>
  [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')

const npr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Nepali-style grouping (1,23,456.00) with "Rs." prefix. */
export const money = (n: number | null | undefined) => (n == null ? '—' : `Rs. ${npr.format(Number(n))}`)

export function date(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateTime(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** A Date as YYYY-MM-DD in the browser's local timezone (never UTC). */
export function localDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Today as YYYY-MM-DD in the user's local timezone (not UTC).
 * `toISOString().slice(0,10)` would be wrong: in Nepal (UTC+5:45) it is still yesterday
 * until 05:45, so "today's attendance" would open on the wrong date every morning.
 */
export function today() {
  return localDate(new Date())
}

export const titleCase = (s: string | null | undefined) =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—'

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(2)}%`)
export const gpa = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(2))

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/** Removes empty strings → null for optional text fields, and drops undefined keys. */
export function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v
  }
  return out as T
}
