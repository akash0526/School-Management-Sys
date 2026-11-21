import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Save, Trash2 } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { SchoolLogo } from '../../components/SchoolLogo'
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader, Spinner } from '../../components/ui'
import { fieldErrors, useToast } from '../../components/ui-utils'
import { del, put } from '../../lib/api'
import { dateTime } from '../../lib/format'
import { useSchoolProfile, type SchoolProfile } from '../../lib/school'

const MAX_LOGO = 300 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

type Form = Record<'name' | 'nameNp' | 'address' | 'phone' | 'email' | 'website' | 'panNo' | 'schoolCode' | 'establishedYear', string>
const toForm = (p: SchoolProfile | null): Form => ({
  name: p?.name ?? '', nameNp: p?.nameNp ?? '', address: p?.address ?? '', phone: p?.phone ?? '', email: p?.email ?? '',
  website: p?.website ?? '', panNo: p?.panNo ?? '', schoolCode: p?.schoolCode ?? '', establishedYear: p?.establishedYear?.toString() ?? '',
})

function useInvalidateBranding() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['school-profile'] })
    void qc.invalidateQueries({ queryKey: ['branding'] })
  }
}

/** School identity shown on the sign-in page, sidebar, receipts and report cards. */
export function SettingsPage() {
  const { data, isLoading, error } = useSchoolProfile()
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <>
      <PageHeader title="School settings" subtitle="Your school's name, contact details and logo appear on the sign-in page, receipts and report cards." />
      {!data && <div className="mb-6"><Notice tone="amber">The school profile hasn't been set up yet. Fill it in below — then you can upload a logo.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* key: re-seed the form when the saved profile changes */}
          <ProfileForm key={data?.updatedAt ?? 'new'} profile={data ?? null} />
        </div>
        <LogoCard profile={data ?? null} />
      </div>
    </>
  )
}

function ProfileForm({ profile }: { profile: SchoolProfile | null }) {
  const toast = useToast()
  const invalidate = useInvalidateBranding()
  const [f, setF] = useState<Form>(() => toForm(profile))
  const m = useMutation({
    mutationFn: () => put('/school/profile', { ...f, establishedYear: f.establishedYear ? Number(f.establishedYear) : null }),
    onSuccess: () => {
      toast.success('School profile saved')
      invalidate()
    },
  })
  const errs = fieldErrors(m.error)
  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    m.mutate()
  }
  return (
    <Card title="School profile">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="School name *" error={errs.name} className="sm:col-span-2"><Input value={f.name} onChange={set('name')} required minLength={2} maxLength={150} placeholder="e.g. Shree Janata Secondary School" /></Field>
        <Field label="Name in Nepali" error={errs.nameNp} className="sm:col-span-2"><Input value={f.nameNp} onChange={set('nameNp')} maxLength={150} placeholder="श्री जनता माध्यमिक विद्यालय" /></Field>
        <Field label="Address" error={errs.address} className="sm:col-span-2"><Input value={f.address} onChange={set('address')} maxLength={300} placeholder="Butwal-11, Rupandehi" /></Field>
        <Field label="Phone" error={errs.phone}><Input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="071-123456" /></Field>
        <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} maxLength={150} /></Field>
        <Field label="Website" error={errs.website}><Input value={f.website} onChange={set('website')} placeholder="https://" /></Field>
        <Field label="PAN no." error={errs.panNo} hint="9 digits — printed on fee receipts"><Input value={f.panNo} onChange={set('panNo')} inputMode="numeric" maxLength={9} pattern="\d{9}" title="9 digits" /></Field>
        <Field label="School code" error={errs.schoolCode} hint="EMIS / institutional code"><Input value={f.schoolCode} onChange={set('schoolCode')} maxLength={30} /></Field>
        <Field label="Established (year)" error={errs.establishedYear}><Input type="number" value={f.establishedYear} onChange={set('establishedYear')} min={1800} max={2200} /></Field>
        <div className="sm:col-span-2"><ErrorBox error={m.error} /></div>
        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <span className="text-xs text-slate-500">{profile?.updatedAt ? `Last saved ${dateTime(profile.updatedAt)}` : 'Not saved yet'}</span>
          <Button type="submit" loading={m.isPending} icon={<Save className="size-4" />}>Save profile</Button>
        </div>
      </form>
    </Card>
  )
}

function LogoCard({ profile }: { profile: SchoolProfile | null }) {
  const toast = useToast()
  const invalidate = useInvalidateBranding()
  const input = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: (dataUrl: string) => put('/school/logo', { dataUrl }),
    onSuccess: () => {
      toast.success('Logo updated')
      invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: () => del('/school/logo'),
    onSuccess: () => {
      toast.success('Logo removed')
      invalidate()
    },
  })

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    setLocalError(null)
    upload.reset()
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) return setLocalError('Please choose a PNG, JPEG or WebP image.')
    if (file.size > MAX_LOGO) return setLocalError(`That image is ${Math.round(file.size / 1024)} KB — the limit is 300 KB. Try a smaller or compressed version.`)
    const reader = new FileReader()
    reader.onload = () => upload.mutate(String(reader.result))
    reader.onerror = () => setLocalError('Could not read that file.')
    reader.readAsDataURL(file)
  }

  return (
    <Card title="Logo">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-32 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
          <SchoolLogo size="xl" src={profile?.logoUrl ?? null} />
        </div>
        <p className="text-xs text-slate-500">Square PNG, JPEG or WebP, up to 300 KB. A transparent background looks best.</p>
        <input ref={input} type="file" accept={LOGO_TYPES.join(',')} className="hidden" onChange={onFile} />
        <div className="flex flex-wrap justify-center gap-2">
          <Button icon={<ImagePlus className="size-4" />} disabled={!profile} loading={upload.isPending} onClick={() => input.current?.click()}>
            {profile?.logoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
          {profile?.logoUrl && (
            <Button variant="secondary" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          )}
        </div>
        {!profile && <p className="text-xs text-amber-700">Save the school profile first.</p>}
        {localError && <Notice tone="amber">{localError}</Notice>}
        <ErrorBox error={upload.error ?? remove.error} />
      </div>
    </Card>
  )
}
