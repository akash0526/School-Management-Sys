import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui'
import { enumOptions, useToast } from '../../components/ui-utils'
import { get, patch, post, type Items } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { clean, date, titleCase } from '../../lib/format'
import { useYearPicker } from '../../lib/hooks'
import type { Exam, Term } from '../../lib/types'

const EXAM_TYPES = ['unit', 'terminal', 'final', 'pre_board', 'entrance'] as const

export function ExamsPage() {
  const { can } = useAuth()
  const { years, yearId, setYearId } = useYearPicker()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Exam | null>(null)
  const exams = useQuery({ queryKey: ['exams', yearId], queryFn: () => get<Items<Exam>>('/exams', { academicYearId: yearId }), enabled: !!yearId })

  return (
    <>
      <PageHeader
        title="Exams & results"
        subtitle="Schedule papers, enter marks, process NEB grades and publish report cards."
        actions={
          <>
            <Select className="w-36" value={yearId ?? ''} onChange={(e) => setYearId(Number(e.target.value))} options={(years.data ?? []).map((y) => ({ value: y.id, label: `Year ${y.name}` }))} />
            {can('exams.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New exam</Button>}
          </>
        }
      />
      <Card padded={false}>
        {exams.isLoading ? <Spinner /> : !exams.data?.items.length ? <Empty title="No exams this year" hint={can('exams.manage') ? 'Create the first terminal exam to get started.' : undefined} /> : (
          <ul className="divide-y divide-slate-100">
            {exams.data.items.map((e) => (
              <li key={e.id} className="flex items-center hover:bg-slate-50">
                <Link to={`/exams/${e.id}`} className="flex min-w-0 flex-1 items-center gap-4 px-5 py-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700 uppercase">{e.examType.slice(0, 2)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{e.name}</div>
                    <div className="text-sm text-slate-500">
                      {titleCase(e.examType)}{e.termName ? ` · ${e.termName}` : ''} · {e.startDate ? `${date(e.startDate)}${e.endDate ? ` – ${date(e.endDate)}` : ''}` : 'No dates'}
                    </div>
                  </div>
                  {e.isPublished ? <Badge tone="green">Published</Badge> : <Badge>Not published</Badge>}
                  <ChevronRight className="size-5 text-slate-300" />
                </Link>
                {can('exams.manage') && (
                  <button type="button" onClick={() => setEditing(e)} className="mr-3 rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700" title="Edit exam" aria-label={`Edit ${e.name}`}>
                    <Pencil className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && yearId && <NewExamModal yearId={yearId} onClose={() => setOpen(false)} />}
      {editing && <EditExamModal exam={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function NewExamModal({ yearId, onClose }: { yearId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const terms = useQuery({ queryKey: ['terms', yearId], queryFn: () => get<Items<Term>>(`/academic/years/${yearId}/terms`) })
  const [f, setF] = useState({ name: '', examType: 'terminal', termId: '', startDate: '', endDate: '', weightageInFinal: '' })
  const m = useMutation({
    mutationFn: () => post('/exams', clean({ ...f, academicYearId: yearId, termId: f.termId ? Number(f.termId) : null, weightageInFinal: f.weightageInFinal ? Number(f.weightageInFinal) : null })),
    onSuccess: () => { toast.success('Exam created'); void qc.invalidateQueries({ queryKey: ['exams'] }); onClose() },
  })
  return (
    <Modal open onClose={onClose} title="New exam" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="exam-form" loading={m.isPending}>Create exam</Button></>}>
      <form id="exam-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={100} placeholder="First Terminal Examination" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.examType} onChange={(e) => setF({ ...f, examType: e.target.value })} options={enumOptions(EXAM_TYPES)} /></Field>
          <Field label="Term"><Select value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })} placeholder="—" options={(terms.data?.items ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End date"><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label="Weight in final (%)" hint="Optional"><Input type="number" min={0} max={100} value={f.weightageInFinal} onChange={(e) => setF({ ...f, weightageInFinal: e.target.value })} /></Field>
        </div>
        <ErrorBox error={m.error} />
      </form>
    </Modal>
  )
}

/** Name, type and dates can change after creation; year and term are fixed (results depend on them). */
function EditExamModal({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState({ name: exam.name, examType: exam.examType, startDate: exam.startDate ?? '', endDate: exam.endDate ?? '' })
  const m = useMutation({
    mutationFn: () => patch(`/exams/${exam.id}`, { name: f.name, examType: f.examType, startDate: f.startDate || null, endDate: f.endDate || null }),
    onSuccess: () => {
      toast.success('Exam updated')
      void qc.invalidateQueries({ queryKey: ['exams'] })
      void qc.invalidateQueries({ queryKey: ['exam'] })
      onClose()
    },
  })
  return (
    <Modal open onClose={onClose} title="Edit exam" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="exam-edit-form" loading={m.isPending}>Save changes</Button></>}>
      <form id="exam-edit-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={100} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" className="col-span-2"><Select value={f.examType} onChange={(e) => setF({ ...f, examType: e.target.value })} options={enumOptions(EXAM_TYPES)} /></Field>
          <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="End date"><Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500">Academic year{exam.termName ? ` (${exam.academicYear}) and term (${exam.termName})` : ` (${exam.academicYear})`} can't be changed once the exam exists.</p>
        <ErrorBox error={m.error} />
      </form>
    </Modal>
  )
}
