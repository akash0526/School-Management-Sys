import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { SchoolLetterhead } from '../../components/SchoolLetterhead'
import { Button, ErrorBox, Notice, Spinner } from '../../components/ui'
import { get } from '../../lib/api'
import { gpa, pct, titleCase } from '../../lib/format'
import type { ReportCard } from '../../lib/types'

const NEB_SCALE = [
  ['90–100', 'A+', '4.0', 'Outstanding'],
  ['80–<90', 'A', '3.6', 'Excellent'],
  ['70–<80', 'B+', '3.2', 'Very good'],
  ['60–<70', 'B', '2.8', 'Good'],
  ['50–<60', 'C+', '2.4', 'Satisfactory'],
  ['40–<50', 'C', '2.0', 'Acceptable'],
  ['35–<40', 'D', '1.6', 'Basic'],
  ['<35', 'NG', '—', 'Not graded'],
]

export function ReportCardPage() {
  const { examId, studentId } = useParams()
  const nav = useNavigate()
  const { data: c, isLoading, error } = useQuery({ queryKey: ['report-card', examId, studentId], queryFn: () => get<ReportCard>(`/exams/${examId}/report-cards/${studentId}`) })
  if (isLoading) return <Spinner />
  if (error || !c) return <ErrorBox error={error ?? 'Not found'} />
  const withheld = c.resultStatus === 'withheld'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={() => nav(-1)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft className="size-4" /> Back</button>
        <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
      </div>
      {!c.isPublished && <div className="no-print mb-4"><Notice tone="amber">Preview: this exam is not published yet. Parents and students can't see it.</Notice></div>}

      <article className="card print-area overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-8 py-6">
          <SchoolLetterhead title="Progress report" subtitle={`${c.examName} · Academic year ${c.academicYear}`} />
          {!withheld && c.gpa != null && (
            <div className="text-right">
              <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">GPA</div>
              <div className="text-3xl font-bold text-brand-700">{gpa(c.gpa)}</div>
            </div>
          )}
        </header>

        <section className="grid grid-cols-2 gap-x-8 gap-y-2 px-8 py-5 text-sm sm:grid-cols-4">
          <Info k="Student" v={c.studentName} />
          <Info k="Class" v={`${c.className} – ${c.sectionName}`} />
          <Info k="Roll no." v={c.rollNo} />
          <Info k="Admission no." v={c.admissionNo} />
          <Info k="Symbol no." v={c.symbolNo} />
          <Info k="Result" v={titleCase(c.resultStatus)} />
          <Info k="Rank in section" v={c.rankInSection} />
          <Info k="Rank in class" v={c.rankInClass} />
        </section>

        {withheld ? (
          <div className="px-8 pb-8"><Notice tone="amber">This result is withheld. Please contact the school office.</Notice></div>
        ) : (
          <>
            <div className="overflow-x-auto px-8">
              <table className="w-full border border-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                  <tr>
                    <th className="border border-slate-200 px-3 py-2 text-left">Subject</th>
                    <th className="border border-slate-200 px-3 py-2 text-left">Component</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Credit hr</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Full</th>
                    <th className="border border-slate-200 px-3 py-2 text-right">Obtained</th>
                    <th className="border border-slate-200 px-3 py-2 text-center">Grade</th>
                    <th className="border border-slate-200 px-3 py-2 text-center">GP</th>
                    <th className="border border-slate-200 px-3 py-2 text-center">Final grade</th>
                  </tr>
                </thead>
                <tbody>
                  {c.subjects.map((s) =>
                    s.components.map((comp, i) => (
                      <tr key={`${s.classSubjectId}-${i}`}>
                        {i === 0 && <td rowSpan={s.components.length} className="border border-slate-200 px-3 py-2 align-top font-medium text-slate-900">{s.subjectName}</td>}
                        <td className="border border-slate-200 px-3 py-2">{comp.name}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{comp.creditHours ?? '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{comp.fullMarks}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{comp.isAbsent ? <span className="text-rose-600">ABS</span> : comp.marksObtained ?? '—'}</td>
                        <td className={`border border-slate-200 px-3 py-2 text-center font-medium ${comp.grade === 'NG' ? 'text-rose-600' : ''}`}>{comp.grade ?? '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 text-center tabular-nums">{comp.gradePoint != null ? Number(comp.gradePoint).toFixed(1) : '—'}</td>
                        {i === 0 && <td rowSpan={s.components.length} className={`border border-slate-200 px-3 py-2 text-center align-middle font-semibold ${s.grade === 'NG' ? 'text-rose-600' : 'text-slate-900'}`}>{s.grade ?? '—'}<div className="text-xs font-normal text-slate-500">{s.gradePoint != null ? Number(s.gradePoint).toFixed(1) : ''}</div></td>}
                      </tr>
                    )),
                  )}
                </tbody>
                <tfoot className="bg-slate-50 font-medium">
                  <tr>
                    <td colSpan={3} className="border border-slate-200 px-3 py-2 text-right">Total</td>
                    <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{c.totalFull ?? '—'}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right tabular-nums">{c.totalObtained ?? '—'}</td>
                    <td colSpan={3} className="border border-slate-200 px-3 py-2 text-center">{pct(c.percentage)} · GPA {gpa(c.gpa)} · {c.finalGrade ?? '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {c.teacherRemarks && <div className="px-8 pt-5 text-sm"><span className="font-medium text-slate-700">Remarks: </span>{c.teacherRemarks}</div>}
          </>
        )}

        <section className="grid gap-6 px-8 py-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Grading scale (NEB)</div>
            <table className="w-full text-xs">
              <tbody>
                {NEB_SCALE.map(([r, g, p, d]) => (
                  <tr key={g} className="border-b border-slate-100 last:border-0"><td className="py-1 text-slate-500">{r}</td><td className="py-1 font-semibold">{g}</td><td className="py-1">{p}</td><td className="py-1 text-slate-500">{d}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-400">Each component is graded separately. Any NG or absence means no GPA is awarded.</p>
          </div>
          <div className="flex items-end justify-around gap-6 pt-10 text-center text-xs text-slate-500">
            <div className="w-32 border-t border-slate-300 pt-1">Class teacher</div>
            <div className="w-32 border-t border-slate-300 pt-1">Principal</div>
          </div>
        </section>
      </article>
    </div>
  )
}

const Info = ({ k, v }: { k: string; v: ReactNode }) => (
  <div><div className="text-xs text-slate-500">{k}</div><div className="font-medium text-slate-900">{v ?? '—'}</div></div>
)
