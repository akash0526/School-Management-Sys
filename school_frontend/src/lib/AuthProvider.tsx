import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, post, refreshAccessToken, setAuthHandlers, tokenStore } from './api'
import { AuthContext, type AuthState } from './auth'
import type { Me } from './types'

/** Not a secret: only says "this browser had a session", so first-time visitors skip a refresh call. */
const HINT = 'sms.hadSession'

async function loadMe(): Promise<Me> {
  const r = await api<{ user: Me }>('/auth/me')
  return r.user
}

/** Tells the other open tabs about sign-in / sign-out, so they follow along. */
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sms-auth') : null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()
  const userRef = useRef<Me | null>(null)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const reset = useCallback(() => {
    localStorage.removeItem(HINT)
    tokenStore.set(null)
    setUser(null)
    qc.clear()
  }, [qc])

  /** Restore the session from the httpOnly refresh cookie. */
  const restore = useCallback(async () => {
    try {
      if (localStorage.getItem(HINT)) {
        if (await refreshAccessToken()) setUser(await loadMe())
        else localStorage.removeItem(HINT)
      }
    } catch {
      /* not signed in */
    }
  }, [])

  useEffect(() => {
    setAuthHandlers({
      onAuthLost: reset,
      onPasswordChangeRequired: () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u)),
    })
    let cancelled = false
    void restore().finally(() => {
      if (!cancelled) setLoading(false)
    })
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'logout' && userRef.current) reset()
      if (e.data === 'login' && !userRef.current) void restore()
    }
    channel?.addEventListener('message', onMessage)
    return () => {
      cancelled = true
      channel?.removeEventListener('message', onMessage)
    }
  }, [reset, restore])

  const login = useCallback(async (username: string, password: string) => {
    const r = await post<{ accessToken: string }>('/auth/login', { username, password })
    tokenStore.set(r.accessToken)
    localStorage.setItem(HINT, '1')
    const me = await loadMe()
    setUser(me)
    channel?.postMessage('login')
    return me
  }, [])

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout')
    } catch {
      /* ignore — we clear locally anyway */
    }
    reset()
    channel?.postMessage('logout')
  }, [reset])

  const acceptToken = useCallback(async (token: string) => {
    tokenStore.set(token)
    setUser(await loadMe())
  }, [])

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions ?? [])
    return {
      user,
      loading,
      login,
      logout,
      acceptToken,
      can: (...p) => p.some((x) => perms.has(x)),
      isFamily: !!user && (user.guardianId != null || user.studentId != null) && perms.size === 0,
    }
  }, [user, loading, login, logout, acceptToken])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
