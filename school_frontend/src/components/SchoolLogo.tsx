import { GraduationCap } from 'lucide-react'
import { useBranding } from '../lib/school'
import { cx } from './ui-utils'

const sizes = { sm: 'size-9', md: 'size-12', lg: 'size-16', xl: 'size-20' } as const

/** The school's uploaded logo, or a neutral emblem until one is uploaded. */
export function SchoolLogo({ size = 'sm', src, className }: { size?: keyof typeof sizes; src?: string | null; className?: string }) {
  const { data } = useBranding()
  const url = src !== undefined ? src : data?.logoUrl
  if (url) return <img src={url} alt="" className={cx(sizes[size], 'shrink-0 rounded-full object-contain', className)} />
  return (
    <div className={cx(sizes[size], 'flex shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm', className)}>
      <GraduationCap className={size === 'sm' ? 'size-5' : 'size-1/2'} />
    </div>
  )
}
