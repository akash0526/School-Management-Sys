import { createContext, useContext } from 'react'
import type { Me } from './types'

export interface AuthState {
  user: Me | null
  loading: boolean
  login: (username: string, password: string) => Promise<Me>
  logout: () => Promise<void>
  /** after a password change the API returns a fresh access token */
  acceptToken: (token: string) => Promise<void>
  /** true if the user holds ANY of the given permissions */
  can: (...perms: string[]) => boolean
  isFamily: boolean
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const c = useContext(AuthContext)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
