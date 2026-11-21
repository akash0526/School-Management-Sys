import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button, ErrorBox, Field, Input, Modal, Spinner } from '../../components/ui'
import { fieldErrors, useToast } from '../../components/ui-utils'
import { get, patch } from '../../lib/api'
import type { GuardianFull } from '../../lib/types'

type Form = Record<'fullName' | 'phone' | 'altPhone' | 'email' | 'occupation' | 'organization' | 'citizenshipNo' | 'address', string>
const toForm = (g: GuardianFull): Form => ({
  fullName: g.fullName, phone: g.phone, altPhone: g.altPhone ?? '', email: g.email ?? '', occupation: g.occupation ?? '',
  organization: g.organization ?? '', citizenshipNo: g.citizenshipNo ?? '', address: g.address ?? '',
})

/** Edit a guardian's contact details. One guardian can be linked to several siblings — all of them see the change. */
export function GuardianEditModal({ guardianId, onClose, onSaved }: { guardianId: number; onClose: () => void; onSaved?: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['guardian', guardianId], queryFn: () => get<GuardianFull>(`/guardians/${guardianId}`) })
  return (
    <Modal open onClose={onClose} title="Edit guardian" footer={data && <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="guardian-edit">Save changes</Button></>}>
      {isLoading ? <Spinner /> : data ? <EditForm g={data} onClose={onClose} onSaved={onSaved} /> : <ErrorBox error={error} />}
    </Modal>
  )
}

function EditForm({ g, onClose, onSaved }: { g: GuardianFull; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState<Form>(() => toForm(g))
  const m = useMutation({
    mutationFn: () => {
      // send only what changed; empty optional fields become null
      const body: Record<string, string | null> = {}
      const orig = toForm(g)
      for (const k of Object.keys(f) as (keyof Form)[]) if (f[k].trim() !== orig[k]) body[k] = f[k].trim() === '' && k !== 'fullName' && k !== 'phone' ? null : f[k].trim()
      return Object.keys(body).length ? patch(`/guardians/${g.id}`, body) : Promise.resolve(null)
    },
    onSuccess: () => {
      toast.success('Guardian updated')
      void qc.invalidateQueries({ queryKey: ['guardian', g.id] })
      void qc.invalidateQueries({ queryKey: ['guardians-of'] })
      void qc.invalidateQueries({ queryKey: ['guardians'] })
      onSaved?.()
      onClose()
    },
  })
  const errs = fieldErrors(m.error)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    m.mutate()
  }
  return (
    <form id="guardian-edit" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name *" error={errs.fullName} className="sm:col-span-2"><Input value={f.fullName} onChange={set('fullName')} required maxLength={150} /></Field>
      <Field label="Phone *" error={errs.phone}><Input value={f.phone} onChange={set('phone')} required inputMode="tel" /></Field>
      <Field label="Alternate phone" error={errs.altPhone}><Input value={f.altPhone} onChange={set('altPhone')} inputMode="tel" /></Field>
      <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} maxLength={150} /></Field>
      <Field label="Occupation" error={errs.occupation}><Input value={f.occupation} onChange={set('occupation')} maxLength={100} /></Field>
      <Field label="Organization" error={errs.organization}><Input value={f.organization} onChange={set('organization')} maxLength={150} /></Field>
      <Field label="Citizenship no." error={errs.citizenshipNo}><Input value={f.citizenshipNo} onChange={set('citizenshipNo')} maxLength={50} /></Field>
      <Field label="Address" error={errs.address} className="sm:col-span-2"><Input value={f.address} onChange={set('address')} maxLength={500} /></Field>
      <div className="sm:col-span-2"><ErrorBox error={m.error} /></div>
      {m.isPending && <div className="text-sm text-slate-500 sm:col-span-2">Saving…</div>}
    </form>
  )
}
