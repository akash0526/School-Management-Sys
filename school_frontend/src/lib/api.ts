/**
 * Tiny fetch wrapper for the School API.
 * - Access token lives in memory only (never localStorage) → not readable after an XSS reload.
 * - Refresh token is an httpOnly cookie set by the API; we call /auth/refresh to get a new access token.
 * - Concurrent 401s share a single refresh request.
 */

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  /** zod field errors (array) or endpoint-specific data (object) */
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
  /** Field → message map for form validation errors. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    if (Array.isArray(this.details)) for (const d of this.details as { path?: string; message: string }[]) if (d.path && !out[d.path]) out[d.path] = d.message
    return out
  }
}

let accessToken: string | null = null
let refreshing: Promise<boolean> | null = null
let onAuthLost: (() => void) | null = null
let onPasswordChangeRequired: (() => void) | null = null

export const tokenStore = {
  set(t: string | null) {
    accessToken = t
  },
  get: () => accessToken,
}

export function setAuthHandlers(h: { onAuthLost: () => void; onPasswordChangeRequired: () => void }) {
  onAuthLost = h.onAuthLost
  onPasswordChangeRequired = h.onPasswordChangeRequired
}

/**
 * Uses the httpOnly refresh cookie to obtain a new access token.
 *
 * The refresh token ROTATES on every use and the API treats a reused token as theft (it signs the
 * user out everywhere). Two tabs refreshing at the same moment would both send the same cookie —
 * so refreshes are serialised across tabs with the Web Locks API. The second tab waits, then sends
 * the cookie the first tab just received (cookies are shared by all tabs).
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) {
    const run = () =>
      fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then(async (r) => {
          if (!r.ok) return false
          const data = (await r.json()) as { accessToken: string }
          accessToken = data.accessToken
          return true
        })
        .catch(() => false)
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    refreshing = (locks ? locks.request('sms-auth-refresh', run) : run()).finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

type Query = Record<string, string | number | boolean | null | undefined>

export function qs(query?: Query): string {
  if (!query) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  /** internal: skip the refresh-and-retry step */
  noRetry?: boolean
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let res: Response
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.')
  }

  if (res.status === 401 && !opts.noRetry && !path.startsWith('/auth/login')) {
    if (await refreshAccessToken()) return api<T>(path, { ...opts, noRetry: true })
    accessToken = null
    onAuthLost?.()
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? safeJson(text) : undefined

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error
    const e = new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, friendly(res.status, err?.message), err?.details)
    if (e.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.()
    throw e
  }
  return data as T
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

function friendly(status: number, message?: string) {
  if (message) return message
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.'
  if (status >= 500) return 'Something went wrong on the server. Please try again.'
  return 'Request failed'
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query })
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} })
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body })
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export interface Items<T> {
  items: T[]
}
