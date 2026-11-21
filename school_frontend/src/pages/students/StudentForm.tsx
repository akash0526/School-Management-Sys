import { useState, type FormEvent } from 'react'
import { Button, ErrorBox, Field, Input, Modal, Select } from '../../components/ui'
import { enumOptions, fieldErrors } from '../../components/ui-utils'
import { patch, post } from '../../lib/api'
import { clean, today } from '../../lib/format'
import type { Student } from '../../lib/types'

const GENDERS = ['male', 'female', 'other'] as const
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const PROVINCES = ['Koshi', 'Madhesh', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim']

const empty = {
  admissionNo: '', firstName: '', middleName: '', lastName: '', fullNameNp: '', gender: 'male', dob: '', bloodGroup: '',
  phone: '', email: '', province: '', district: '', localLevel: '', wardNo: '', tole: '', motherTongue: '', casteEthnicity: '',
  religion: '', previousSchool: '', admissionDate: today(), nationality: 'Nepali', birthCertNo: '',
}
type FormState = typeof empty

export function StudentFormModal({ open, onClose, student, onSaved }: { open: boolean; onClose: () => void; student?: Student; onSaved: (s: { id: number }) => void }) {
  const [f, setF] = useState<FormState>(() =>
    student
      ? (Object.fromEntries(Object.keys(empty).map((k) => [k, (student as unknown as Record<string, unknown>)[k] == null ? '' : String((student as unknown as Record<string, unknown>)[k])])) as FormState)
      : empty,
  )
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const errs = fieldErrors(error)
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = clean({ ...f, wardNo: f.wardNo ? Number(f.wardNo) : null, bloodGroup: f.bloodGroup || null, nationality: f.nationality || undefined })
    if (student) delete (body as Partial<typeof body>).admissionDate
    if (!body.admissionDate) delete (body as Partial<typeof body>).admissionDate
    try {
      const r = student ? await patch<{ id: number }>(`/students/${student.id}`, body) : await post<{ id: number }>('/students', body)
      onSaved(r ?? { id: student!.id })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={student ? 'Edit student' : 'Admit new student'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="student-form" loading={busy}>{student ? 'Save changes' : 'Admit student'}</Button>
        </>
      }
    >
      <form id="student-form" onSubmit={submit} className="space-y-6">
        <section>
          <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">Basic information</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Admission no. *" error={errs.admissionNo}><Input value={f.admissionNo} onChange={set('admissionNo')} required maxLength={30} /></Field>
            <Field label="Admission date" error={errs.admissionDate}><Input type="date" value={f.admissionDate} onChange={set('admissionDate')} disabled={!!student} /></Field>
            <div />
            <Field label="First name *" error={errs.firstName}><Input value={f.firstName} onChange={set('firstName')} required maxLength={50} /></Field>
            <Field label="Middle name" error={errs.middleName}><Input value={f.middleName} onChange={set('middleName')} maxLength={50} /></Field>
            <Field label="Last name *" error={errs.lastName}><Input value={f.lastName} onChange={set('lastName')} required maxLength={50} /></Field>
            <Field label="Full name (Nepali)" error={errs.fullNameNp}><Input value={f.fullNameNp} onChange={set('fullNameNp')} maxLength={150} placeholder="पूरा नाम" /></Field>
            <Field label="Gender *" error={errs.gender}><Select value={f.gender} onChange={set('gender')} options={enumOptions(GENDERS)} /></Field>
            <Field label="Date of birth (AD) *" error={errs.dob}><Input type="date" value={f.dob} onChange={set('dob')} required max={today()} /></Field>
            <Field label="Blood group" error={errs.bloodGroup}><Select value={f.bloodGroup} onChange={set('bloodGroup')} placeholder="—" options={BLOOD.map((b) => ({ value: b, label: b }))} /></Field>
            <Field label="Phone" error={errs.phone}><Input value={f.phone} onChange={set('phone')} placeholder="98XXXXXXXX" /></Field>
            <Field label="Email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} /></Field>
          </div>
        </section>
        <section>
          <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">Address</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Province" error={errs.province}><Select value={f.province} onChange={set('province')} placeholder="—" options={PROVINCES.map((p) => ({ value: p, label: p }))} /></Field>
            <Field label="District" error={errs.district}><Input value={f.district} onChange={set('district')} maxLength={50} /></Field>
            <Field label="Municipality / Rural mun." error={errs.localLevel}><Input value={f.localLevel} onChange={set('localLevel')} maxLength={80} /></Field>
            <Field label="Ward no." error={errs.wardNo}><Input type="number" min={1} max={40} value={f.wardNo} onChange={set('wardNo')} /></Field>
            <Field label="Tole" error={errs.tole}><Input value={f.tole} onChange={set('tole')} maxLength={100} /></Field>
          </div>
        </section>
        <section>
          <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">Other details</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Mother tongue" error={errs.motherTongue}><Input value={f.motherTongue} onChange={set('motherTongue')} maxLength={50} /></Field>
            <Field label="Caste / ethnicity" error={errs.casteEthnicity}><Input value={f.casteEthnicity} onChange={set('casteEthnicity')} maxLength={80} /></Field>
            <Field label="Religion" error={errs.religion}><Input value={f.religion} onChange={set('religion')} maxLength={50} /></Field>
            <Field label="Nationality" error={errs.nationality}><Input value={f.nationality} onChange={set('nationality')} maxLength={50} /></Field>
            <Field label="Birth certificate no." error={errs.birthCertNo}><Input value={f.birthCertNo} onChange={set('birthCertNo')} maxLength={50} /></Field>
            <Field label="Previous school" error={errs.previousSchool}><Input value={f.previousSchool} onChange={set('previousSchool')} maxLength={150} /></Field>
          </div>
        </section>
        <ErrorBox error={error} />
      </form>
    </Modal>
  )
}
