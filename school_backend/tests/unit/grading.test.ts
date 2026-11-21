import { describe, expect, it } from 'vitest';
import {
  type ComponentInput,
  type GradeBand,
  GradingScaleError,
  computeStudentResult,
  describeGaps,
  gradeForPercent,
  gradeFromGpa,
  gradingScaleGaps,
  rank,
} from '../../src/modules/exams/business/grading.js';

// Same bands as 99_seed.sql (NEB letter grading)
const NEB: GradeBand[] = [
  { minPercent: 90, maxPercent: 100.01, grade: 'A+', gradePoint: 4.0 },
  { minPercent: 80, maxPercent: 90, grade: 'A', gradePoint: 3.6 },
  { minPercent: 70, maxPercent: 80, grade: 'B+', gradePoint: 3.2 },
  { minPercent: 60, maxPercent: 70, grade: 'B', gradePoint: 2.8 },
  { minPercent: 50, maxPercent: 60, grade: 'C+', gradePoint: 2.4 },
  { minPercent: 40, maxPercent: 50, grade: 'C', gradePoint: 2.0 },
  { minPercent: 35, maxPercent: 40, grade: 'D', gradePoint: 1.6 },
  { minPercent: 0, maxPercent: 35, grade: 'NG', gradePoint: null },
];

let nextId = 1;
const comp = (p: Partial<ComponentInput> & { classSubjectId: number; fullMarks: number; marks: number | null }): ComponentInput => ({
  componentId: nextId++,
  passMarks: p.passMarks ?? 0,
  creditHours: null,
  subjectCreditHours: null,
  isAbsent: p.marks === null,
  ...p,
});

describe('gradeForPercent', () => {
  it.each([
    [100, 'A+'], [90, 'A+'], [89.99, 'A'], [80, 'A'], [70, 'B+'], [60, 'B'], [50, 'C+'], [40, 'C'], [35, 'D'], [34.99, 'NG'], [0, 'NG'],
  ])('%s%% → %s', (pct, grade) => {
    expect(gradeForPercent(pct, NEB).grade).toBe(grade);
  });
  it('throws when no band covers the value', () => {
    expect(() => gradeForPercent(120, NEB)).toThrow();
  });

  it('a value outside the configured bands raises a scale error, not a bare Error', () => {
    // a hand-entered scale that starts at 40 leaves 0-40 ungraded
    const gap: GradeBand[] = [{ minPercent: 40, maxPercent: 100.01, grade: 'A', gradePoint: 4 }];
    expect(() => gradeForPercent(39.6, gap)).toThrow(GradingScaleError);
    expect(() => gradeForPercent(39.6, gap)).toThrow(/gap/);
  });
});

describe('gradingScaleGaps', () => {
  it('the seeded NEB scale covers 0-100 with no gaps', () => {
    expect(gradingScaleGaps(NEB)).toEqual([]);
  });

  it('reports a missing range at the bottom', () => {
    const partial: GradeBand[] = [
      { minPercent: 80, maxPercent: 100.01, grade: 'A', gradePoint: 4 },
      { minPercent: 60, maxPercent: 80, grade: 'B', gradePoint: 3 },
    ];
    expect(gradingScaleGaps(partial)).toEqual([{ from: 0, to: 60 }]);
  });

  it('reports a missing range at the top (top band must reach past 100)', () => {
    const noTop: GradeBand[] = [{ minPercent: 0, maxPercent: 90, grade: 'A', gradePoint: 4 }];
    expect(gradingScaleGaps(noTop)).toEqual([{ from: 90, to: 100 }]);
  });

  it('reports a gap in the middle', () => {
    const holed: GradeBand[] = [
      { minPercent: 0, maxPercent: 40, grade: 'NG', gradePoint: null },
      { minPercent: 40, maxPercent: 50, grade: 'C', gradePoint: 2 },
      { minPercent: 60, maxPercent: 100.01, grade: 'A', gradePoint: 4 },
    ];
    expect(gradingScaleGaps(holed)).toEqual([{ from: 50, to: 60 }]);
  });

  it('treats 100% as covered only when the top band reaches beyond it', () => {
    // maxPercent is exclusive: a band ending at 100 leaves exactly 100% ungraded
    const exclusive: GradeBand[] = [{ minPercent: 0, maxPercent: 100, grade: 'A', gradePoint: 4 }];
    expect(gradingScaleGaps(exclusive)).toEqual([{ from: 100, to: 100 }]);
    // ...which is why the schema's own top band uses 100.01
    expect(gradingScaleGaps(NEB)).toEqual([]);
  });

  it('does not report a gap for an empty scale list here (that is caught as "no scale configured")', () => {
    expect(gradingScaleGaps([])).toEqual([{ from: 0, to: 100 }]);
  });

  it('ignores band order', () => {
    const shuffled = [...NEB].reverse();
    expect(gradingScaleGaps(shuffled)).toEqual([]);
  });
});

describe('describeGaps', () => {
  it('describes one gap', () => {
    expect(describeGaps([{ from: 0, to: 40 }])).toBe('0\u201340% is not covered by any band');
  });
  it('describes several gaps', () => {
    expect(describeGaps([{ from: 0, to: 40 }, { from: 50, to: 60 }])).toBe(
      '0\u201340% and 50\u201360% are not covered by any band',
    );
  });
  it('describes a single percentage point', () => {
    expect(describeGaps([{ from: 100, to: 100 }])).toBe('100% is not covered by any band');
  });
});

describe('gradeFromGpa', () => {
  it.each([
    [4.0, 'A+'], [3.61, 'A+'], [3.6, 'A'], [3.21, 'A'], [3.2, 'B+'], [2.8, 'B'], [2.4, 'C+'], [2.0, 'C'], [1.6, 'D'],
  ])('%s → %s', (gpa, g) => expect(gradeFromGpa(gpa)).toBe(g));
});

describe('computeStudentResult', () => {
  it('grades theory and internal separately and weights by component credit hours (NEB)', () => {
    // English: TH 75 (3 ch) + IN 25 (1 ch);  TH 60/75 = 80% → A 3.6;  IN 24/25 = 96% → A+ 4.0
    const r = computeStudentResult(
      [
        comp({ classSubjectId: 1, fullMarks: 75, passMarks: 26.25, creditHours: 3, marks: 60 }),
        comp({ classSubjectId: 1, fullMarks: 25, creditHours: 1, marks: 24 }),
      ],
      NEB,
    );
    expect(r.status).toBe('graded');
    expect(r.subjects[0].gradePoint).toBe(3.7); // (3×3.6 + 1×4.0) / 4
    expect(r.gpa).toBe(3.7);
    expect(r.finalGrade).toBe('A+');
    expect(r.totalObtained).toBe(84);
  });

  it('falls back to subject credit hours split by full marks', () => {
    // subject 5 ch, TH 100 → whole 5 ch;  other subject 4 ch with TH 50 + PR 50 → 2 ch each
    const r = computeStudentResult(
      [
        comp({ classSubjectId: 1, fullMarks: 100, subjectCreditHours: 5, marks: 95 }), // A+ 4.0 ×5
        comp({ classSubjectId: 2, fullMarks: 50, subjectCreditHours: 4, marks: 35 }), // 70% B+ 3.2 ×2
        comp({ classSubjectId: 2, fullMarks: 50, subjectCreditHours: 4, marks: 45 }), // 90% A+ 4.0 ×2
      ],
      NEB,
    );
    expect(r.components.map((c) => c.creditHours)).toEqual([5, 2, 2]);
    expect(r.gpa).toBe(round((5 * 4 + 2 * 3.2 + 2 * 4) / 9));
  });

  it('weights by full marks when no credit hours are configured', () => {
    const r = computeStudentResult(
      [comp({ classSubjectId: 1, fullMarks: 100, marks: 90 }), comp({ classSubjectId: 2, fullMarks: 50, marks: 30 })], // 4.0 ×100, 60% B 2.8 ×50
      NEB,
    );
    expect(r.gpa).toBe(round((100 * 4 + 50 * 2.8) / 150));
  });

  it('below 35% theory pass marks → NG for the subject and no GPA', () => {
    const r = computeStudentResult(
      [
        comp({ classSubjectId: 1, fullMarks: 75, passMarks: 26.25, creditHours: 3, marks: 26 }), // 34.67% → NG
        comp({ classSubjectId: 1, fullMarks: 25, creditHours: 1, marks: 25 }),
        comp({ classSubjectId: 2, fullMarks: 100, passMarks: 35, marks: 99 }),
      ],
      NEB,
    );
    expect(r.components[0].grade).toBe('NG');
    expect(r.subjects.find((s) => s.classSubjectId === 1)?.isGraded).toBe(false);
    expect(r.status).toBe('not_graded');
    expect(r.gpa).toBeNull();
    expect(r.finalGrade).toBe('NG');
  });

  it('pass marks above the D band still apply (e.g. school sets 40 pass marks)', () => {
    const r = computeStudentResult([comp({ classSubjectId: 1, fullMarks: 100, passMarks: 40, marks: 38 })], NEB);
    expect(r.components[0].grade).toBe('NG');
  });

  it('absent in one component → not graded; absent everywhere → absent', () => {
    const partly = computeStudentResult(
      [comp({ classSubjectId: 1, fullMarks: 100, marks: null }), comp({ classSubjectId: 2, fullMarks: 100, marks: 80 })],
      NEB,
    );
    expect(partly.status).toBe('not_graded');
    expect(partly.subjects[0].grade).toBe('ABS');
    const all = computeStudentResult([comp({ classSubjectId: 1, fullMarks: 100, marks: null })], NEB);
    expect(all.status).toBe('absent');
    expect(all.finalGrade).toBe('ABS');
  });

  it('100% is included in the top band', () => {
    expect(computeStudentResult([comp({ classSubjectId: 1, fullMarks: 100, marks: 100 })], NEB).gpa).toBe(4);
  });

  it('rejects an empty component list', () => {
    expect(() => computeStudentResult([], NEB)).toThrow();
  });
});

describe('rank', () => {
  it('uses competition ranking (1, 2, 2, 4) and skips non-graded students', () => {
    const ranks = rank([
      { enrollmentId: 1, gpa: 3.8, percentage: 91, status: 'graded' },
      { enrollmentId: 2, gpa: 3.5, percentage: 80, status: 'graded' },
      { enrollmentId: 3, gpa: 3.5, percentage: 80, status: 'graded' },
      { enrollmentId: 4, gpa: 3.5, percentage: 79, status: 'graded' }, // same GPA, lower % → behind
      { enrollmentId: 5, gpa: null, percentage: 95, status: 'not_graded' },
    ]);
    expect([...ranks.entries()]).toEqual([[1, 1], [2, 2], [3, 2], [4, 4]]);
    expect(ranks.has(5)).toBe(false);
  });
});

function round(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
