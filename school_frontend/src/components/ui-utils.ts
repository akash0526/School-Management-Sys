import { createContext, useContext } from 'react'
import { ApiError } from '../lib/api'
import { titleCase } from '../lib/format'

/** Joins class names, skipping falsy values. */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export const enumOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }))

export const ToastCtx = createContext<{ success: (t: string) => void; error: (e: unknown) => void } | null>(null)
export function useToast() {
  const c = useContext(ToastCtx)
  if (!c) throw new Error('useToast outside ToastProvider')
  return c
}

/** Field errors from an ApiError (zod details), keyed by top-level field. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {}
  const out: Record<string, string> = {}
  for (const d of e.details as { path: string; message: string }[]) {
    const k = d.path.split('.')[0]!
    if (!out[k]) out[k] = d.message
  }
  return out
}
