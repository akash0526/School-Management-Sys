import { useBranding, useSchoolProfile } from '../lib/school'
import { SchoolLogo } from './SchoolLogo'

/** Logo + school name + contact line for printed documents (receipts, report cards). */
export function SchoolLetterhead({ title, subtitle, showPan = false }: { title: string; subtitle?: string; showPan?: boolean }) {
  const branding = useBranding()
  const { data: p } = useSchoolProfile()
  const name = p?.name ?? (branding.data?.configured ? branding.data.name : 'School')
  const contact = [p?.address, p?.phone && `Tel: ${p.phone}`, p?.email].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-3">
      <SchoolLogo size="md" src={p ? p.logoUrl : undefined} />
      <div className="min-w-0">
        <div className="text-lg leading-tight font-bold text-slate-900">{name}</div>
        {p?.nameNp && <div className="text-sm text-slate-700">{p.nameNp}</div>}
        {contact && <div className="text-xs text-slate-500">{contact}</div>}
        {showPan && p?.panNo && <div className="text-xs text-slate-500">PAN: {p.panNo}</div>}
        <div className="mt-1 text-sm font-semibold tracking-wide text-brand-700 uppercase">
          {title}
          {subtitle && <span className="font-normal tracking-normal text-slate-500 normal-case"> · {subtitle}</span>}
        </div>
      </div>
    </div>
  )
}
