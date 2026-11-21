/**
 * NEB GRADING — pure functions (no DB, no HTTP). Fully unit-tested in tests/unit/grading.test.ts
 *
 * Rules implemented (current NEB letter grading, 2078 BS onward):
 *  - Each component (theory / internal / practical) is graded separately from its percentage,
 *    using the grading bands stored in the database (grading_scale_items).
 *  - Scoring below the component's pass marks (35% of theory) => NG (no grade point).
 *  - Absent => ABS (no grade point).
 *  - Subject grade point = credit-hour-weighted average of its component grade points.
 *  - GPA = Σ(credit hours × grade point) ÷ Σ credit hours over ALL components.
 *  - Any NG/ABS component => subject not graded => overall GPA not given ("not_graded").
 *  - Final letter grade from GPA: >3.6 A+, >3.2 A, >2.8 B+, >2.4 B, >2.0 C+, >1.6 C, else D.
 */

export interface GradeBand {
  minPercent: number; // inclusive
  maxPercent: number; // exclusive
  grade: string;
  gradePoint: number | null;
}

export interface ComponentInput {
  componentId: number;
  classSubjectId: number;
  fullMarks: number;
  passMarks: number;
  creditHours: number | null; // component credit hours (NEB)
  subjectCreditHours: number | null; // fallback: subject credit hours split by full marks
  marks: number | null;
  isAbsent: boolean;
}

export interface ComponentResult {
  componentId: number;
  classSubjectId: number;
  percentage: number | null;
  grade: string;
  gradePoint: number | null;
  creditHours: number;
}

export interface SubjectResult {
  classSubjectId: number;
  totalObtained: number;
  totalFull: number;
  percentage: number;
  grade: string;
  gradePoint: number | null;
  isGraded: boolean;
}

export type ResultStatus = 'graded' | 'not_graded' | 'absent';

export interface StudentResult {
  components: ComponentResult[];
  subjects: SubjectResult[];
  totalObtained: number;
  totalFull: number;
  percentage: number;
  gpa: number | null;
  finalGrade: string;
  status: ResultStatus;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function gradeForPercent(percent: number, bands: GradeBand[]): { grade: string; gradePoint: number | null } {
  const band = bands.find((b) => percent >= b.minPercent && percent < b.maxPercent);
  if (!band) throw new Error(`No grading band covers ${percent}%`);
  return { grade: band.grade, gradePoint: band.gradePoint };
}

export function gradeFromGpa(gpa: number): string {
  if (gpa > 3.6) return 'A+';
  if (gpa > 3.2) return 'A';
  if (gpa > 2.8) return 'B+';
  if (gpa > 2.4) return 'B';
  if (gpa > 2.0) return 'C+';
  if (gpa > 1.6) return 'C';
  return 'D';
}

function componentWeight(c: ComponentInput, subjectFull: number): number {
  if (c.creditHours && c.creditHours > 0) return c.creditHours;
  if (c.subjectCreditHours && c.subjectCreditHours > 0) return (c.subjectCreditHours * c.fullMarks) / subjectFull;
  return c.fullMarks; // no credit hours configured: weight by full marks
}

export function computeStudentResult(components: ComponentInput[], bands: GradeBand[]): StudentResult {
  if (components.length === 0) throw new Error('Student has no exam components');

  const bySubject = new Map<number, ComponentInput[]>();
  for (const c of components) bySubject.set(c.classSubjectId, [...(bySubject.get(c.classSubjectId) ?? []), c]);

  const componentResults: ComponentResult[] = [];
  const subjectResults: SubjectResult[] = [];

  for (const [classSubjectId, comps] of bySubject) {
    const subjectFull = comps.reduce((s, c) => s + c.fullMarks, 0);
    const results = comps.map((c): ComponentResult => {
      const weight = componentWeight(c, subjectFull);
      if (c.isAbsent || c.marks === null) {
        return { componentId: c.componentId, classSubjectId, percentage: null, grade: 'ABS', gradePoint: null, creditHours: weight };
      }
      const percentage = round2((c.marks / c.fullMarks) * 100);
      let { grade, gradePoint } = gradeForPercent(percentage, bands);
      if (c.marks < c.passMarks) {
        grade = 'NG';
        gradePoint = null;
      }
      return { componentId: c.componentId, classSubjectId, percentage, grade, gradePoint, creditHours: weight };
    });
    componentResults.push(...results);

    const obtained = comps.reduce((s, c) => s + (c.isAbsent || c.marks === null ? 0 : c.marks), 0);
    const graded = results.every((r) => r.gradePoint !== null);
    let gradePoint: number | null = null;
    let grade = results.every((r) => r.grade === 'ABS') ? 'ABS' : 'NG';
    if (graded) {
      const w = results.reduce((s, r) => s + r.creditHours, 0);
      gradePoint = round2(results.reduce((s, r) => s + r.creditHours * (r.gradePoint as number), 0) / w);
      grade = gradeFromGpa(gradePoint);
    }
    subjectResults.push({
      classSubjectId,
      totalObtained: round2(obtained),
      totalFull: subjectFull,
      percentage: round2((obtained / subjectFull) * 100),
      grade,
      gradePoint,
      isGraded: graded,
    });
  }

  const totalObtained = round2(subjectResults.reduce((s, r) => s + r.totalObtained, 0));
  const totalFull = subjectResults.reduce((s, r) => s + r.totalFull, 0);
  const percentage = round2((totalObtained / totalFull) * 100);

  if (componentResults.every((c) => c.grade === 'ABS')) {
    return { components: componentResults, subjects: subjectResults, totalObtained, totalFull, percentage, gpa: null, finalGrade: 'ABS', status: 'absent' };
  }
  if (subjectResults.some((s) => !s.isGraded)) {
    return { components: componentResults, subjects: subjectResults, totalObtained, totalFull, percentage, gpa: null, finalGrade: 'NG', status: 'not_graded' };
  }
  const totalWeight = componentResults.reduce((s, c) => s + c.creditHours, 0);
  const gpa = round2(componentResults.reduce((s, c) => s + c.creditHours * (c.gradePoint as number), 0) / totalWeight);
  return { components: componentResults, subjects: subjectResults, totalObtained, totalFull, percentage, gpa, finalGrade: gradeFromGpa(gpa), status: 'graded' };
}

/**
 * Standard competition ranking (1, 2, 2, 4) among GRADED students only,
 * by GPA then percentage. Returns rank per enrollment id for a group.
 */
export function rank(rows: Array<{ enrollmentId: number; gpa: number | null; percentage: number; status: ResultStatus }>): Map<number, number> {
  const graded = rows.filter((r) => r.status === 'graded' && r.gpa !== null).sort((a, b) => b.gpa! - a.gpa! || b.percentage - a.percentage);
  const ranks = new Map<number, number>();
  graded.forEach((r, i) => {
    const prev = graded[i - 1];
    const same = prev && prev.gpa === r.gpa && prev.percentage === r.percentage;
    ranks.set(r.enrollmentId, same ? ranks.get(prev.enrollmentId)! : i + 1);
  });
  return ranks;
}
