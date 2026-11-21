import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookMarked, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Button, Card, ErrorBox, Modal, Notice, Spinner } from '../../components/ui'
import { cx, useToast } from '../../components/ui-utils'
import { get, put } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useClassSubjects, useSections } from '../../lib/hooks'
import type { ClassSubject, EnrollmentDetail } from '../../lib/types'

const groupName = (g: string | null) => g ?? 'Optional'

/**
 * Optional / elective subjects for the student's current enrollment (Grade 9–12 mostly).
 * One subject per optional group; marks entry and results only include chosen subjects.
 */
export function OptionalSubjectsCard({ enrollmentId }: { enrollmentId: number }) {
  const { can } = useAuth()
  const [editing, setEditing] = useState(false)
  const enr = useQuery({ queryKey: ['enrollment', enrollmentId], queryFn: () => get<EnrollmentDetail>(`/enrollments/${enrollmentId}`) })
  const sections = useSections(enr.data?.academicYearId)
  const section = sections.data?.find((s) => s.id === enr.data?.sectionId)
  const subjects = useClassSubjects(enr.data?.academicYearId, section?.classId)

  const groups = useMemo(() => {
    const opts = (subjects.data ?? []).filter((cs) => cs.isOptional && (cs.streamId == null || cs.streamId === section?.streamId))
    const map = new Map<string, ClassSubject[]>()
    for (const cs of opts) map.set(groupName(cs.optionalGroup), [...(map.get(groupName(cs.optionalGroup)) ?? []), cs])
    return [...map.entries()]
  }, [subjects.data, section?.streamId])

  if (enr.isLoading || sections.isLoading || subjects.isLoading) return <Card title="Optional subjects"><Spinner /></Card>
  if (!enr.data) return null
  const chosen = enr.data.subjects
  const missing = groups.filter(([g]) => !chosen.some((c) => groupName(c.optionalGroup) === g)).map(([g]) => g)

  return (
    <Card
      title="Optional subjects"
      actions={groups.length > 0 && can('enrollment.manage') && <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>{chosen.length ? 'Change' : 'Choose'}</Button>}
    >
      {groups.length === 0 ? (
        <p className="text-sm text-slate-500">All subjects in this class are compulsory.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {chosen.map((c) => (
              <span key={c.classSubjectId} className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm">
                <BookMarked className="size-4 text-brand-600" />
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-xs text-slate-500">{groupName(c.optionalGroup)}</span>
              </span>
            ))}
          </div>
          {missing.length > 0 && <Notice tone="amber">Not chosen yet: {missing.join(', ')}. The student won't appear in those subjects' marks entry until a choice is saved.</Notice>}
        </div>
      )}
      {editing && <ChooseModal enrollment={enr.data} groups={groups} onClose={() => setEditing(false)} />}
    </Card>
  )
}

function ChooseModal({ enrollment, groups, onClose }: { enrollment: EnrollmentDetail; groups: [string, ClassSubject[]][]; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [pick, setPick] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(groups.map(([g, list]) => [g, enrollment.subjects.find((c) => list.some((cs) => cs.id === c.classSubjectId))?.classSubjectId ?? null])),
  )
  const m = useMutation({
    mutationFn: () => put(`/enrollments/${enrollment.id}/subjects`, { classSubjectIds: Object.values(pick).filter((v): v is number => v != null) }),
    onSuccess: () => {
      toast.success('Optional subjects saved')
      void qc.invalidateQueries({ queryKey: ['enrollment', enrollment.id] })
      onClose()
    },
  })
  return (
    <Modal open onClose={onClose} title="Choose optional subjects" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-5">
        {groups.map(([g, list]) => (
          <fieldset key={g}>
            <legend className="mb-2 text-sm font-semibold text-slate-800">{g} <span className="font-normal text-slate-500">— pick one</span></legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((cs) => (
                <label key={cs.id} className={cx('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition', pick[g] === cs.id ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200' : 'border-slate-200 hover:border-slate-300')}>
                  <input type="radio" name={g} className="accent-brand-600" checked={pick[g] === cs.id} onChange={() => setPick((p) => ({ ...p, [g]: cs.id }))} />
                  <span className="flex-1 font-medium text-slate-800">{cs.subjectName}</span>
                  {cs.creditHours != null && <Badge>{cs.creditHours} cr</Badge>}
                </label>
              ))}
              <label className={cx('flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-sm', pick[g] == null ? 'border-slate-400 bg-slate-50' : 'border-slate-200')}>
                <input type="radio" name={g} className="accent-slate-600" checked={pick[g] == null} onChange={() => setPick((p) => ({ ...p, [g]: null }))} />
                <span className="text-slate-500">None</span>
              </label>
            </div>
          </fieldset>
        ))}
        <p className="text-xs text-slate-500">Marks already entered for a subject that is removed here stay in the record but no longer count.</p>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  )
}
