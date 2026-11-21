/**
 * End-to-end smoke test against a RUNNING server + real database.
 *
 *   API_URL=http://localhost:4000 ADMIN_USER=admin ADMIN_PASS='...' API_KEY='sk_...' node tests/e2e/smoke.mjs
 *
 * Walks a full school workflow: setup → staff → students/guardians → enrollment →
 * attendance → exams/results → fees → public website API, plus security checks.
 * Uses a random suffix so it can be re-run on the same database.
 */
const BASE = (process.env.API_URL ?? 'http://localhost:4000') + '/api/v1';
const sfx = Math.random().toString(36).slice(2, 7).toUpperCase();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());
let passed = 0;
const failures = [];

async function call(method, path, { token, body, apiKey } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers['X-API-Key'] = apiKey;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failures.push(name); console.log(`  ✘ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}
async function expect(name, status, p) {
  const r = await p;
  check(`${name} → ${status}`, r.status === status, { got: r.status, data: r.data });
  return r.data;
}
async function login(username, password) {
  const r = await call('POST', '/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${JSON.stringify(r.data)}`);
  return r.data.accessToken;
}
async function firstLogin(username, tempPass, newPass) {
  const t = await login(username, tempPass);
  await expect(`${username} blocked until password change`, 403, call('GET', '/students/mine', { token: t }));
  await expect(`${username} changes password`, 200, call('POST', '/auth/change-password', { token: t, body: { currentPassword: tempPass, newPassword: newPass } }));
  return login(username, newPass);
}

console.log(`\nSmoke test  suffix=${sfx}  today=${today}\n`);

// ───────────────────────── security basics
console.log('Security');
await expect('no token', 401, call('GET', '/students'));
await expect('garbage token', 401, call('GET', '/students', { token: 'abc.def.ghi' }));
await expect('wrong password', 401, call('POST', '/auth/login', { body: { username: process.env.ADMIN_USER, password: 'wrong-password' } }));
await expect('unknown field rejected', 400, call('POST', '/auth/login', { body: { username: 'a', password: 'b', isAdmin: true } }));
const admin = await login(process.env.ADMIN_USER, process.env.ADMIN_PASS);
check('admin login', !!admin);

// ───────────────────────── academic setup
console.log('Academic setup');
const years = await expect('list years', 200, call('GET', '/academic/years', { token: admin }));
const year = (years.items ?? years).find((y) => y.isCurrent);
check('current year is 2083', year?.name === '2083', year);
const classes = await call('GET', '/academic/classes', { token: admin });
const g10 = (classes.data.items ?? classes.data).find((c) => c.name === 'Grade 10');
check('Grade 10 exists', !!g10);
const eng = await expect('create subject ENG', 201, call('POST', '/academic/subjects', { token: admin, body: { code: `ENG${sfx}`, name: `English ${sfx}` } }));
const mth = await expect('create subject MATH', 201, call('POST', '/academic/subjects', { token: admin, body: { code: `MTH${sfx}`, name: `Maths ${sfx}` } }));
const csEng = await expect('class-subject ENG', 201, call('POST', '/academic/class-subjects', { token: admin, body: { academicYearId: year.id, classId: g10.id, subjectId: eng.id, creditHours: 4, sequence: 1 } }));
const csMth = await expect('class-subject MATH', 201, call('POST', '/academic/class-subjects', { token: admin, body: { academicYearId: year.id, classId: g10.id, subjectId: mth.id, creditHours: 5, sequence: 2 } }));

// ───────────────────────── staff
console.log('Staff');
const teacher = await expect('create teacher', 201, call('POST', '/staff', { token: admin, body: {
  employeeNo: `T-${sfx}`, firstName: 'Sita', lastName: 'Sharma', gender: 'female', phone: '9800000001',
  designation: 'Secondary Teacher', staffType: 'teaching', joinDate: '2025-04-14', citizenshipNo: '12-34-56', bankAccountNo: '0011223344',
  showOnWebsite: true, publicBio: 'Maths teacher' } }));
await expect('teacher login account', 201, call('POST', `/staff/${teacher.id}/account`, { token: admin, body: { username: `t${sfx}`.toLowerCase(), password: 'Temp1234abc', roles: ['teacher'] } }));
const section = await expect('create section', 201, call('POST', '/academic/sections', { token: admin, body: { academicYearId: year.id, classId: g10.id, name: `A${sfx}`, classTeacherId: teacher.id, capacity: 40 } }));
await expect('assign teacher to MATH', 201, call('POST', '/academic/teacher-assignments', { token: admin, body: { sectionId: section.id, classSubjectId: csMth.id, staffId: teacher.id } }));

// ───────────────────────── students, guardian, enrollment
console.log('Students & enrollment');
const students = [];
const dobs = ['2010-05-01', '2010-08-15', '2011-01-20'];
for (let i = 0; i < 3; i++) {
  const s = await expect(`create student ${i + 1}`, 201, call('POST', '/students', { token: admin, body: {
    admissionNo: `ADM-${sfx}-${i + 1}`, firstName: ['Ram', 'Gita', 'Hari'][i], lastName: 'Thapa', gender: i === 1 ? 'female' : 'male', dob: dobs[i] } }));
  students.push(s);
}
await expect('duplicate admission no', 409, call('POST', '/students', { token: admin, body: { admissionNo: `ADM-${sfx}-1`, firstName: 'X', lastName: 'Y', gender: 'male', dob: '2010-01-01' } }));

// date-of-birth rules: a person is born before they are admitted, and never in the future
await expect('future dob rejected', 400, call('POST', '/students', { token: admin, body: {
  admissionNo: `ADM-${sfx}-future`, firstName: 'Future', lastName: 'Kid', gender: 'male', dob: '2099-01-01' } }));
await expect('dob equal to admission date rejected', 400, call('POST', '/students', { token: admin, body: {
  admissionNo: `ADM-${sfx}-same`, firstName: 'Same', lastName: 'Day', gender: 'male', dob: today, admissionDate: today } }));
await expect('dob before admission date accepted', 201, call('POST', '/students', { token: admin, body: {
  admissionNo: `ADM-${sfx}-ok`, firstName: 'Valid', lastName: 'Entry', gender: 'female', dob: '2012-03-04', admissionDate: today } }));
const g = await expect('add guardian to student 1', 201, call('POST', `/students/${students[0].id}/guardians`, { token: admin, body: { relation: 'father', isPrimary: true, guardian: { fullName: 'Krishna Thapa', phone: '9811111111' } } }));
await expect('guardian login account', 201, call('POST', `/guardians/${g.guardianId}/account`, { token: admin, body: { username: `p${sfx}`.toLowerCase(), password: 'Temp1234abc' } }));
const enr = [];
for (let i = 0; i < 3; i++) {
  enr.push(await expect(`enroll student ${i + 1}`, 201, call('POST', '/enrollments', { token: admin, body: { studentId: students[i].id, sectionId: section.id, rollNo: i + 1, symbolNo: `SYM${sfx}${i + 1}` } })));
}
await expect('double enrollment same year', 409, call('POST', '/enrollments', { token: admin, body: { studentId: students[0].id, sectionId: section.id } }));

// ───────────────────────── logins for teacher & parent
console.log('Teacher & parent first login');
const tTok = await firstLogin(`t${sfx}`.toLowerCase(), 'Temp1234abc', 'Teacher@2083secure');
const pTok = await firstLogin(`p${sfx}`.toLowerCase(), 'Temp1234abc', 'Parent@2083secure');
const mine = await expect('parent sees own children', 200, call('GET', '/students/mine', { token: pTok }));
check('parent has exactly 1 child', (mine.items ?? mine).length === 1, mine);
await expect('parent cannot view other student', 403, call('GET', `/students/${students[1].id}`, { token: pTok }));
await expect('teacher cannot manage users', 403, call('GET', '/users', { token: tTok }));
const staffView = await call('GET', `/staff/${teacher.id}`, { token: tTok });
check('teacher reads own staff record', staffView.status === 200);
const staffList = await call('GET', '/staff', { token: tTok });
const others = (staffList.data.items ?? []).filter((m) => m.id !== teacher.id);
check('colleagues\' bank/citizenship hidden from teacher', staffList.status === 200 && others.every((m) => !('bankAccountNo' in m) && !('citizenshipNo' in m)), others[0]);
check('teacher sees own full record', 'bankAccountNo' in staffView.data, staffView.data);

// ───────────────────────── attendance
console.log('Attendance');
await expect('class teacher marks attendance', 200, call('PUT', `/attendance/sections/${section.id}`, { token: tTok, body: { date: today, records: [
  { enrollmentId: enr[0].id, status: 'present' }, { enrollmentId: enr[1].id, status: 'absent', remarks: 'sick' }, { enrollmentId: enr[2].id, status: 'late' } ] } }));
await expect('re-mark (upsert) works', 200, call('PUT', `/attendance/sections/${section.id}`, { token: tTok, body: { date: today, records: [{ enrollmentId: enr[2].id, status: 'present' }] } }));
await expect('future date rejected', 400, call('PUT', `/attendance/sections/${section.id}`, { token: tTok, body: { date: '2099-01-01', records: [{ enrollmentId: enr[0].id, status: 'present' }] } }));
const roster = await expect('roster', 200, call('GET', `/attendance/sections/${section.id}?date=${today}`, { token: tTok }));
check('roster shows 3 students', JSON.stringify(roster).split('enrollmentId').length - 1 >= 3, roster);
await expect('parent sees child summary', 200, call('GET', `/attendance/students/${students[0].id}/summary`, { token: pTok }));
await expect('parent blocked from other child', 403, call('GET', `/attendance/students/${students[1].id}/summary`, { token: pTok }));
await expect('staff attendance', 200, call('PUT', '/attendance/staff', { token: admin, body: { date: today, records: [{ staffId: teacher.id, status: 'present', checkIn: '09:45', checkOut: '16:00' }] } }));

// ───────────────────────── exams
console.log('Exams & results');
const exam = await expect('create exam', 201, call('POST', '/exams', { token: admin, body: { academicYearId: year.id, name: `First Terminal ${sfx}`, examType: 'terminal' } }));
const schEng = await expect('ENG schedule (TH 75 + IN 25)', 201, call('POST', `/exams/${exam.id}/schedules`, { token: admin, body: { classSubjectId: csEng.id, examDate: today, components: [
  { name: 'Theory', componentType: 'theory', fullMarks: 75, passMarks: 26.25, creditHours: 3 }, { name: 'Internal', componentType: 'internal', fullMarks: 25, passMarks: 0, creditHours: 1 } ] } }));
const schMth = await expect('MATH schedule (TH 100)', 201, call('POST', `/exams/${exam.id}/schedules`, { token: admin, body: { classSubjectId: csMth.id, components: [{ name: 'Theory', componentType: 'theory', fullMarks: 100, passMarks: 35 }] } }));
const comp = (sch, name) => (sch.components ?? []).find((c) => c.name === name)?.id;
const mthTh = comp(schMth, 'Theory'), engTh = comp(schEng, 'Theory'), engIn = comp(schEng, 'Internal');
check('components returned', mthTh && engTh && engIn, { schEng, schMth });
await expect('teacher enters MATH marks', 200, call('PUT', `/exams/components/${mthTh}/marks`, { token: tTok, body: { sectionId: section.id, entries: [
  { enrollmentId: enr[0].id, marksObtained: 92 }, { enrollmentId: enr[1].id, marksObtained: 30 }, { enrollmentId: enr[2].id, marksObtained: 81.5 } ] } }));
await expect('teacher blocked from ENG (not assigned)', 403, call('PUT', `/exams/components/${engTh}/marks`, { token: tTok, body: { sectionId: section.id, entries: [{ enrollmentId: enr[0].id, marksObtained: 50 }] } }));
await expect('marks above full marks rejected', 400, call('PUT', `/exams/components/${mthTh}/marks`, { token: tTok, body: { sectionId: section.id, entries: [{ enrollmentId: enr[0].id, marksObtained: 101 }] } }));
await expect('admin enters ENG theory', 200, call('PUT', `/exams/components/${engTh}/marks`, { token: admin, body: { sectionId: section.id, entries: [
  { enrollmentId: enr[0].id, marksObtained: 70 }, { enrollmentId: enr[1].id, marksObtained: 60 }, { enrollmentId: enr[2].id, marksObtained: null, isAbsent: true } ] } }));
await expect('process blocked: missing internal marks', 400, call('POST', `/exams/${exam.id}/process`, { token: admin, body: { sectionId: section.id } }));
await expect('admin enters ENG internal', 200, call('PUT', `/exams/components/${engIn}/marks`, { token: admin, body: { sectionId: section.id, entries: [
  { enrollmentId: enr[0].id, marksObtained: 24 }, { enrollmentId: enr[1].id, marksObtained: 20 }, { enrollmentId: enr[2].id, marksObtained: 22 } ] } }));
await expect('verify marks', 200, call('POST', `/exams/${exam.id}/verify`, { token: admin, body: { sectionId: section.id } }));
await expect('process results', 200, call('POST', `/exams/${exam.id}/process`, { token: admin, body: { sectionId: section.id } }));
await expect('parent cannot see unpublished report card', 403, call('GET', `/exams/${exam.id}/report-cards/${students[0].id}`, { token: pTok }));
await expect('publish', 204, call('POST', `/exams/${exam.id}/publish`, { token: admin, body: { published: true } }));
const results = await expect('results list', 200, call('GET', `/exams/${exam.id}/results?sectionId=${section.id}`, { token: admin }));
const items = results.items ?? results;
const r1 = items.find((r) => r.enrollmentId === enr[0].id), r2 = items.find((r) => r.enrollmentId === enr[1].id), r3 = items.find((r) => r.enrollmentId === enr[2].id);
console.log('    results:', items.map((r) => `${r.enrollmentId}:${r.resultStatus}/${r.gpa ?? '-'}/${r.finalGrade ?? '-'}/rank${r.rankInSection ?? '-'}`).join('  '));
check('student 1 graded with GPA', r1?.resultStatus === 'graded' && Number(r1.gpa) > 3, r1);
check('student 1 rank 1', r1?.rankInSection === 1, r1);
check('student 2 NG (maths 30 < 35%)', r2?.resultStatus === 'not_graded' && r2.gpa === null, r2);
check('student 3 absent in ENG theory → not graded', r3?.resultStatus !== 'graded', r3);
const card = await expect('parent sees published report card', 200, call('GET', `/exams/${exam.id}/report-cards/${students[0].id}`, { token: pTok }));
check('report card has subjects', JSON.stringify(card).includes(`ENG${sfx}`), card);

// ── withholding: an official decision, visible to the family but without numbers
const order = (await call('GET', `/exams/${exam.id}/results?sectionId=${section.id}`, { token: admin })).data.items;
const top = order.find((r) => r.rankInSection === 1);
const wh = await expect('withhold the top student', 200, call('POST', `/exams/${exam.id}/withhold`, { token: admin, body: { withheld: true, enrollmentIds: [top.enrollmentId] } }));
check('withhold reports 1 change', wh.updated === 1, wh);
const whList = (await call('GET', `/exams/${exam.id}/results?sectionId=${section.id}`, { token: admin })).data.items;
const whTop = whList.find((r) => r.enrollmentId === top.enrollmentId);
check('withheld student shows status with no GPA/grade', whTop.resultStatus === 'withheld' && whTop.gpa === null && whTop.finalGrade === null, whTop);
const whCard = await expect('family still sees the report card (result withheld)', 200, call('GET', `/exams/${exam.id}/report-cards/${students[0].id}`, { token: pTok }));
check('withheld card hides every number', whCard.resultStatus === 'withheld' && whCard.gpa === null && whCard.percentage === null && whCard.finalGrade === null, whCard);
check('withheld card lists the subjects sat, with no marks', whCard.subjects.length > 0 && whCard.subjects.every((s) => s.totalObtained === null && s.grade === 'WITHHELD'), whCard.subjects);
check('withheld card exposes no rank', whCard.rankInSection === null && whCard.rankInClass === null, whCard);
await expect('withhold needs a target (never the whole school by accident)', 400, call('POST', `/exams/${exam.id}/withhold`, { token: admin, body: { withheld: true } }));
await expect('release', 200, call('POST', `/exams/${exam.id}/withhold`, { token: admin, body: { withheld: false, enrollmentIds: [top.enrollmentId] } }));
const relList = (await call('GET', `/exams/${exam.id}/results?sectionId=${section.id}`, { token: admin })).data.items;
const relTop = relList.find((r) => r.enrollmentId === top.enrollmentId);
check('released student is graded again with the SAME gpa', relTop.resultStatus === 'graded' && relTop.gpa === top.gpa, { before: top.gpa, after: relTop.gpa });
await expect('release with nothing withheld is a conflict', 409, call('POST', `/exams/${exam.id}/withhold`, { token: admin, body: { withheld: false, enrollmentIds: [top.enrollmentId] } }));

// re-processing must NOT silently release a withheld result
await expect('withhold again', 200, call('POST', `/exams/${exam.id}/withhold`, { token: admin, body: { withheld: true, enrollmentIds: [top.enrollmentId] } }));
await expect('unpublish to re-process', 204, call('POST', `/exams/${exam.id}/publish`, { token: admin, body: { published: false } }));
await expect('re-process results', 200, call('POST', `/exams/${exam.id}/process`, { token: admin, body: { sectionId: section.id } }));
const afterReprocess = (await call('GET', `/exams/${exam.id}/results?sectionId=${section.id}`, { token: admin })).data.items;
check('re-processing preserved the withheld status', afterReprocess.find((r) => r.enrollmentId === top.enrollmentId)?.resultStatus === 'withheld', afterReprocess.find((r) => r.enrollmentId === top.enrollmentId));
await expect('release after re-process', 200, call('POST', `/exams/${exam.id}/withhold`, { token: admin, body: { withheld: false, enrollmentIds: [top.enrollmentId] } }));
await expect('re-publish', 204, call('POST', `/exams/${exam.id}/publish`, { token: admin, body: { published: true } }));

// ───────────────────────── fees
console.log('Fees');
const ft = await expect('create fee type', 201, call('POST', '/fees/types', { token: admin, body: { code: `TUI_${sfx.replace(/[0-9]/g, 'X')}`, name: `Tuition ${sfx}` } }));
await expect('fee structure', 201, call('POST', '/fees/structures', { token: admin, body: { academicYearId: year.id, classId: g10.id, feeTypeId: ft.id, amount: 3000, frequency: 'monthly' } }));
await expect('10% scholarship for student 1', 201, call('POST', '/fees/discounts', { token: admin, body: { enrollmentId: enr[0].id, feeTypeId: ft.id, discountType: 'percent', value: 10, reason: 'scholarship' } }));
await expect('percent > 100 rejected', 400, call('POST', '/fees/discounts', { token: admin, body: { enrollmentId: enr[0].id, discountType: 'percent', value: 150, reason: 'merit' } }));
const period = `2083-Mangsir-${sfx}`;
const gen = await expect('generate invoices', 201, call('POST', '/fees/invoices/generate', { token: admin, body: { academicYearId: year.id, sectionId: section.id, billingPeriod: period, frequencies: ['monthly'], feeTypeIds: [ft.id], issueDate: today } }));
check('3 invoices, 2700+3000+3000 = 8700', gen.created === 3 && gen.totalBilled === 8700, gen);
const gen2 = await expect('re-generate is idempotent', 201, call('POST', '/fees/invoices/generate', { token: admin, body: { academicYearId: year.id, sectionId: section.id, billingPeriod: period, frequencies: ['monthly'], feeTypeIds: [ft.id], issueDate: today } }));
check('second run skips all 3', gen2.created === 0 && gen2.skipped.alreadyBilled === 3, gen2);
// The batch write replaces a per-student loop, so the things that loop guaranteed need their own
// assertions: the ledger charge must match the invoice the DB computed, and a second run must not
// double-charge. Totals come from a trigger on invoice_items, so a batch that read the invoice
// row before its items existed would silently post 0.
const invList = await expect('invoice list for the period', 200, call('GET', `/fees/invoices?billingPeriod=${encodeURIComponent(period)}&limit=50`, { token: admin }));
const invRows = invList.items ?? [];
check('3 invoices visible in the period', invRows.length === 3, { n: invRows.length });
check('invoice totals are non-zero (trigger computed after items)', invRows.every((i) => i.totalAmount > 0), invRows.map((i) => i.totalAmount));
const stmt = await expect('student 1 statement after generate', 200, call('GET', `/fees/students/${students[0].id}/statement`, { token: admin }));
const charge = (stmt.entries ?? []).filter((e) => e.entryType === 'charge');
check('exactly one charge row per invoice (no double posting)', charge.length === 1, charge);
check('ledger debit equals the discounted invoice total 2700', charge.length === 1 && charge[0].debit === 2700, charge);
check('balance equals the charge before any payment', stmt.balance === 2700, stmt.balance);
// re-running the batch must not add ledger rows
const before = (await call('GET', `/fees/students/${students[0].id}/statement`, { token: admin })).data;
await expect('re-generate same period again', 201, call('POST', '/fees/invoices/generate', { token: admin, body: { academicYearId: year.id, sectionId: section.id, billingPeriod: period, frequencies: ['monthly'], feeTypeIds: [ft.id], issueDate: today } }));
const after = (await call('GET', `/fees/students/${students[0].id}/statement`, { token: admin })).data;
check('re-run posts no extra ledger rows', after.entries.length === before.entries.length, { before: before.entries.length, after: after.entries.length });
check('re-run leaves the balance unchanged', after.balance === before.balance, { before: before.balance, after: after.balance });

await expect('eSewa without reference rejected', 400, call('POST', '/fees/receipts', { token: admin, body: { studentId: students[0].id, amount: 1000, method: 'esewa' } }));
const rc1 = await expect('collect 2000 cash (partial)', 201, call('POST', '/fees/receipts', { token: admin, body: { studentId: students[0].id, amount: 2000, method: 'cash' } }));
const inv1 = rc1.allocations[0].invoiceId;
let inv = await expect('invoice detail', 200, call('GET', `/fees/invoices/${inv1}`, { token: admin }));
check('invoice partial, paid 2000 of 2700', inv.status === 'partial' && inv.paidAmount === 2000 && inv.totalAmount === 2700, inv);
const rc2 = await expect('collect 1000 khalti (700 + 300 advance)', 201, call('POST', '/fees/receipts', { token: admin, body: { studentId: students[0].id, amount: 1000, method: 'khalti', referenceNo: `KH${sfx}` } }));
check('advance 300', rc2.advance === 300, rc2);
inv = (await call('GET', `/fees/invoices/${inv1}`, { token: admin })).data;
check('invoice now paid', inv.status === 'paid', inv);
let st = await expect('parent sees statement', 200, call('GET', `/fees/students/${students[0].id}/statement`, { token: pTok }));
check('balance -300 (advance)', st.balance === -300, st);
await expect('parent blocked from other statement', 403, call('GET', `/fees/students/${students[1].id}/statement`, { token: pTok }));
await expect('same invoice twice in allocations rejected', 400, call('POST', '/fees/receipts', { token: admin, body: { studentId: students[0].id, amount: 2, method: 'cash', allocations: [{ invoiceId: inv1, amount: 1 }, { invoiceId: inv1, amount: 1 }] } }));
await expect('overpay via explicit allocation blocked by DB', 400, call('POST', '/fees/receipts', { token: admin, body: { studentId: students[0].id, amount: 500, method: 'cash', allocations: [{ invoiceId: inv1, amount: 500 }] } }));
await expect('teacher cannot collect fees', 403, call('POST', '/fees/receipts', { token: tTok, body: { studentId: students[0].id, amount: 100, method: 'cash' } }));
await expect('cancel receipt 2', 204, call('POST', `/fees/receipts/${rc2.receiptId}/cancel`, { token: admin, body: { reason: 'Gateway reversed' } }));
inv = (await call('GET', `/fees/invoices/${inv1}`, { token: admin })).data;
check('invoice back to partial after cancel', inv.status === 'partial' && inv.paidAmount === 2000, inv);
st = (await call('GET', `/fees/students/${students[0].id}/statement`, { token: admin })).data;
check('balance 700 after cancel', st.balance === 700, st);
await expect('cannot cancel invoice with payments', 409, call('POST', `/fees/invoices/${inv1}/cancel`, { token: admin, body: { reason: 'test' } }));

// ───────────────────────── public website API
console.log('Public website API');
const KEY = process.env.API_KEY;
await expect('no API key', 401, call('GET', '/public/notices'));
await expect('wrong API key', 401, call('GET', '/public/notices', { apiKey: 'sk_' + 'x'.repeat(43) }));
await expect('JWT is not an API key', 401, call('GET', '/public/notices', { token: admin }));
await expect('notices', 200, call('GET', '/public/notices', { apiKey: KEY }));
await expect('events', 200, call('GET', '/public/events', { apiKey: KEY }));
const pubStaff = await expect('public staff', 200, call('GET', '/public/staff', { apiKey: KEY }));
check('public staff has no phone/bank', !JSON.stringify(pubStaff).includes('9800000001') && !JSON.stringify(pubStaff).includes('0011223344'), pubStaff);
const inq = { externalRef: `WEB-${sfx}`, studentName: 'Maya Gurung', applyingClassName: 'Grade 10', phone: '9822222222', message: 'Admission for 2084?' };
const q1 = await expect('inquiry created', 201, call('POST', '/public/inquiries', { apiKey: KEY, body: inq }));
const q2 = await expect('inquiry re-sync is idempotent', 200, call('POST', '/public/inquiries', { apiKey: KEY, body: inq }));
check('same inquiry id', q1.id === q2.id && q2.duplicate === true, { q1, q2 });
const lk = await expect('result lookup by symbol + DOB', 200, call('POST', '/public/results/lookup', { apiKey: KEY, body: { symbolNo: `SYM${sfx}1`, dob: dobs[0] } }));
check('lookup returns GPA, never DOB', lk.results?.[0]?.gpa && !JSON.stringify(lk).includes(dobs[0]), lk);
for (let i = 0; i < 5; i++) await call('POST', '/public/results/lookup', { apiKey: KEY, body: { symbolNo: `SYM${sfx}2`, dob: '2000-01-0' + (i + 1) } });
await expect('brute-force DOB guessing throttled', 429, call('POST', '/public/results/lookup', { apiKey: KEY, body: { symbolNo: `SYM${sfx}2`, dob: dobs[1] } }));

// ───────────────────────── refresh-token rotation & theft detection
console.log('Refresh tokens');
const rawLogin = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }) });
const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').match(/rt=([^;]+)/)?.[1];
const setCookie = rawLogin.headers.get('set-cookie') ?? '';
check('refresh cookie is HttpOnly + SameSite=Strict', /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), setCookie);
const rt1 = cookieOf(rawLogin);
const refresh = (rt) => fetch(BASE + '/auth/refresh', { method: 'POST', headers: { Cookie: `rt=${rt}` } });
const rf = await refresh(rt1);
const rt2 = cookieOf(rf);
check("refresh rotates the token", rf.status === 200 && rt2 && rt2 !== rt1, rf.status);
check('old token reuse → 401', (await refresh(rt1)).status === 401);
check('after reuse, the NEW token is revoked too (all sessions killed)', (await refresh(rt2)).status === 401);
await expect('…and live admin access tokens die with them', 401, call('GET', '/auth/me', { token: admin }));
const admin2 = await login(process.env.ADMIN_USER, process.env.ADMIN_PASS);

// ───────────────────────── session revocation is immediate (access tokens are session-bound)
console.log('Revocation');
await expect('weak new password rejected', 400, call('POST', '/auth/change-password', { token: tTok, body: { currentPassword: 'Teacher@2083secure', newPassword: 'Password123' } }));
await expect('password containing username rejected', 400, call('POST', '/auth/change-password', { token: tTok, body: { currentPassword: 'Teacher@2083secure', newPassword: `t${sfx}`.toLowerCase() + 'X9' } }));
check('cross-site refresh refused', (await fetch(BASE + '/auth/refresh', { method: 'POST', headers: { Cookie: `rt=${rt2}`, Origin: 'https://evil.example' } })).status === 403);
const tid = (await call('GET', '/auth/me', { token: tTok })).data?.user?.userId;
await expect('teacher token works before reset', 200, call('GET', '/auth/me', { token: tTok }));
const reset = await expect('admin resets teacher password', 200, call('POST', `/users/${tid}/reset-password`, { token: admin2 }));
await expect('teacher access token dies immediately after reset', 401, call('GET', '/auth/me', { token: tTok }));
const lo = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }) });
const loTok = (await lo.json()).accessToken;
await expect('fresh token works', 200, call('GET', '/auth/me', { token: loTok }));
await fetch(BASE + '/auth/logout', { method: 'POST', headers: { Cookie: `rt=${cookieOf(lo)}` } });
await expect('access token dies on logout', 401, call('GET', '/auth/me', { token: loTok }));


// ───────────────────────── leaving the school ends access
console.log('Leaving');
const tTemp = await login(`t${sfx}`.toLowerCase(), reset.temporaryPassword);
await expect('teacher (pending password change) can reach /me', 200, call('GET', '/auth/me', { token: tTemp }));
await expect('teacher marked resigned', 200, call('PATCH', `/staff/${teacher.id}`, { token: admin2, body: { status: 'resigned' } }));
await expect('resigned teacher\'s live token dies', 401, call('GET', '/auth/me', { token: tTemp }));
await expect('resigned teacher cannot log in', 401, call('POST', '/auth/login', { body: { username: `t${sfx}`.toLowerCase(), password: reset.temporaryPassword } }));
const tUser = (await call('GET', `/users?search=t${sfx}`.toLowerCase(), { token: admin2 })).data?.items?.[0];
check('their user account is now inactive', tUser && tUser.isActive === false, tUser);
const pct = await expect('search for a literal %', 200, call('GET', '/users?search=%25', { token: admin2 }));
check('…matches nothing (no wildcard injection)', pct.items?.length === 0, pct.total);

// ───────────────────────── summary
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed:\n - ' + failures.join('\n - ')); process.exit(1); }
