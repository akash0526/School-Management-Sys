import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { get } from './api'

export interface DemoAccount {
  role: string
  username: string
  password: string
}
export interface Branding {
  name: string
  nameNp: string | null
  logoUrl: string | null
  /** false until an admin saves the school profile */
  configured: boolean
  /** only in a demo database */
  demoAccounts?: DemoAccount[]
}
export interface SchoolProfile {
  name: string
  nameNp: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  panNo: string | null
  schoolCode: string | null
  establishedYear: number | null
  logoUrl: string | null
  updatedAt: string | null
}

/** Public: name + logo for the sign-in screen and the sidebar. */
export const useBranding = () =>
  useQuery({ queryKey: ['branding'], queryFn: () => get<Branding>('/school/branding'), staleTime: 10 * 60_000, retry: 1 })

/** Full profile (address, phone, PAN) for receipts, report cards and settings. Needs a login. */
export const useSchoolProfile = () =>
  useQuery({ queryKey: ['school-profile'], queryFn: () => get<{ profile: SchoolProfile | null }>('/school/profile').then((r) => r.profile), staleTime: 10 * 60_000 })

/** Browser tab title and icon follow the school. */
export function useDocumentBranding() {
  const { data } = useBranding()
  useEffect(() => {
    if (!data) return
    document.title = data.configured ? data.name : 'School Portal'
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link && data.logoUrl) {
      link.href = data.logoUrl
      link.type = ''
    }
  }, [data])
}
