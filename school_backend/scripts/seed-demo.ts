/**
 * DEMO SCHOOL — loads "Himalayan Model Secondary School, Butwal" into an EMPTY database.
 *
 *   npm run db:demo                 (rebuilds the database, then runs this script)
 *   npx tsx scripts/seed-demo.ts    (only on a freshly installed database)
 *
 * Every record is created through the real API (in-process), so invoices, discounts, receipts,
 * marks, GPA and ranks follow exactly the same rules as in production. Deterministic: the same
 * school is produced on every run. All demo logins share one password (DEMO_PASSWORD).
 *
 * NOT for a live school: run `npm run db:reset` before entering real data.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { buildContainer } from '../src/container.js';
import { createLogger } from '../src/shared/logger.js';
import { todayInNepal } from '../src/shared/time.js';

const { values: args } = parseArgs({ options: { force: { type: 'boolean', default: false } } });
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo@School2083';
const t0 = Date.now();

// in-process: the per-IP safety limiter is meant for real clients, not a bulk loader
const env = { ...loadEnv(), API_RATE_LIMIT_PER_MIN: 1_000_000 };
const container = buildContainer(env, createLogger('error', false));
const db = container.core.db;
const http = request(createApp(container));
const TODAY = todayInNepal();

// ───────────────────────────── helpers
let seed = 2083;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p: number) => rand() < p;
const gauss = () => {
  let u = 0;
  while (!u) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 6 = Saturday
const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');
const mobile = () => `98${pick(['0', '1', '4', '5', '6'])}${digits(7)}`;

let token = '';
let calls = 0;
async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const m = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let req = http[m]('/api/v1' + path).set('Authorization', `Bearer ${token}`);
  const res = body === undefined ? await req : await req.send(body as object);
  calls++;
  if (res.status === 401 && token) {
    // access tokens live 15 minutes — log in again and retry once
    await login();
    req = http[m]('/api/v1' + path).set('Authorization', `Bearer ${token}`);
    const again = body === undefined ? await req : await req.send(body as object);
    if (again.status < 300) return again.body as T;
  }
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`);
  return res.body as T;
}
async function login() {
  const r = await http.post('/api/v1/auth/login').send({ username: 'admin', password: DEMO_PASSWORD });
  if (r.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(r.body)}`);
  token = r.body.accessToken;
}
const step = (s: string) => console.log(`• ${s}`);

// ───────────────────────────── reference data
const MALE = ['Aarav', 'Aayush', 'Bibek', 'Bishal', 'Bikash', 'Dipesh', 'Gaurav', 'Hemant', 'Kiran', 'Kushal', 'Manish', 'Nischal', 'Pratik', 'Prabin', 'Rabin', 'Rohan', 'Sagar', 'Samir', 'Sandesh', 'Saroj', 'Sujan', 'Sushant', 'Ujjwal', 'Yubraj', 'Aashish', 'Anish', 'Bipin', 'Prajwal', 'Riwaj', 'Utsav'];
const FEMALE = ['Aakriti', 'Aastha', 'Anjali', 'Asmita', 'Bandana', 'Barsha', 'Binita', 'Dikshya', 'Elina', 'Isha', 'Kabita', 'Karuna', 'Manisha', 'Nisha', 'Pooja', 'Prakriti', 'Prerana', 'Rojina', 'Sabina', 'Samikshya', 'Shreya', 'Smriti', 'Sneha', 'Sristi', 'Sushmita', 'Trishna', 'Usha', 'Aayusha', 'Riya', 'Srijana'];
const SURNAMES = ['Sharma', 'Adhikari', 'Thapa', 'Gurung', 'Magar', 'Shrestha', 'Poudel', 'Bhandari', 'KC', 'Pandey', 'Tharu', 'Chaudhary', 'Yadav', 'Rana', 'Pun', 'Basnet', 'Khanal', 'Neupane', 'Bhattarai', 'Aryal', 'Gautam', 'Ghimire', 'Pokharel', 'Acharya', 'Kunwar', 'Sapkota', 'Bhusal', 'Gyawali', 'Malla', 'Shahi'];
const FATHERS = ['Ram', 'Hari', 'Krishna', 'Shyam', 'Gopal', 'Bishnu', 'Dil Bahadur', 'Man Bahadur', 'Narayan', 'Prakash', 'Rajendra', 'Deepak', 'Mohan', 'Surya', 'Tek Bahadur', 'Bal Krishna', 'Govinda', 'Keshav', 'Madhav', 'Yam Bahadur'];
const MOTHERS = ['Sita', 'Gita', 'Laxmi', 'Kamala', 'Sarita', 'Radha', 'Parbati', 'Bimala', 'Durga', 'Kalpana', 'Mina', 'Sabitri', 'Sunita', 'Tara', 'Ambika', 'Bhagwati'];
const JOBS = ['Business', 'Teacher', 'Farmer', 'Civil Servant', 'Foreign Employment (Qatar)', 'Foreign Employment (Malaysia)', 'Engineer', 'Nurse', 'Shopkeeper', 'Driver', 'Bank Officer', 'Nepal Army', 'Contractor', 'Homemaker'];
const LOCAL = ['Butwal Sub-Metropolitan City', 'Butwal Sub-Metropolitan City', 'Butwal Sub-Metropolitan City', 'Tilottama Municipality', 'Sainamaina Municipality', 'Devdaha Municipality'];
const TOLES = ['Traffic Chowk', 'Milanchowk', 'Golpark', 'Kalikanagar', 'Deepnagar', 'Shankarnagar', 'Manigram', 'Yogikuti', 'Belbas', 'Hatbazar', 'Devinagar', 'Buddhanagar'];
const TONGUE: Record<string, string> = { Tharu: 'Tharu', Chaudhary: 'Tharu', Magar: 'Magar', Pun: 'Magar', Gurung: 'Gurung', Yadav: 'Bhojpuri', Shrestha: 'Newari' };
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'] as const;

// BS 2083 month starts (AD). Billing is monthly by Nepali month.
const MONTHS: Array<[string, string]> = [
  ['Baisakh', '2026-04-14'], ['Jestha', '2026-05-15'], ['Ashadh', '2026-06-15'], ['Shrawan', '2026-07-17'],
  ['Bhadra', '2026-08-17'], ['Ashwin', '2026-09-17'], ['Kartik', '2026-10-18'], ['Mangsir', '2026-11-17'],
  ['Poush', '2026-12-16'], ['Magh', '2027-01-15'], ['Falgun', '2027-02-13'], ['Chaitra', '2027-03-15'],
];

type CompMap = Map<number, Array<{ id: number; componentType: string; fullMarks: number }>>;
type Group = 'pre' | 'low' | 'mid' | 'upper' | 'sec' | 'sci' | 'mgmt';
interface SubjectDef { code: string; ch: number; optional?: string; practical?: boolean }
const SUBJECTS: Record<Group, SubjectDef[]> = {
  pre: [{ code: 'ENG', ch: 2 }, { code: 'NEP', ch: 2 }, { code: 'MTH', ch: 2 }, { code: 'ART', ch: 2 }],
  low: [{ code: 'NEP', ch: 4 }, { code: 'ENG', ch: 4 }, { code: 'MTH', ch: 4 }, { code: 'SER', ch: 4 }, { code: 'HPC', ch: 3 }],
  mid: [{ code: 'NEP', ch: 4 }, { code: 'ENG', ch: 4 }, { code: 'MTH', ch: 4 }, { code: 'SCI', ch: 4 }, { code: 'SOC', ch: 4 }, { code: 'HPC', ch: 2 }, { code: 'CMP', ch: 2, practical: true }],
  upper: [{ code: 'NEP', ch: 5 }, { code: 'ENG', ch: 5 }, { code: 'MTH', ch: 5 }, { code: 'SCI', ch: 5 }, { code: 'SOC', ch: 4 }, { code: 'HPC', ch: 2 }, { code: 'CMP', ch: 2, practical: true }],
  sec: [{ code: 'ENG', ch: 4 }, { code: 'NEP', ch: 4 }, { code: 'MTH', ch: 4 }, { code: 'SCI', ch: 4, practical: true }, { code: 'SOC', ch: 4 }, { code: 'OMT', ch: 4, optional: 'Optional I' }, { code: 'ACC', ch: 4, optional: 'Optional I' }, { code: 'CMP', ch: 4, optional: 'Optional II', practical: true }, { code: 'ECO', ch: 4, optional: 'Optional II' }],
  sci: [{ code: 'ENG', ch: 4 }, { code: 'NEP', ch: 3 }, { code: 'PHY', ch: 5, practical: true }, { code: 'CHE', ch: 5, practical: true }, { code: 'MTH', ch: 5 }, { code: 'BIO', ch: 5, optional: 'Elective', practical: true }, { code: 'CMP', ch: 5, optional: 'Elective', practical: true }],
  mgmt: [{ code: 'ENG', ch: 4 }, { code: 'NEP', ch: 3 }, { code: 'ACC', ch: 5 }, { code: 'ECO', ch: 5 }, { code: 'BUS', ch: 5 }, { code: 'MTH', ch: 5, optional: 'Elective' }, { code: 'CMP', ch: 5, optional: 'Elective', practical: true }],
};
const SUBJECT_NAMES: Record<string, string> = {
  NEP: 'Nepali', ENG: 'English', MTH: 'Mathematics', SER: 'Our Surroundings', HPC: 'Health, Physical & Creative Arts', SCI: 'Science & Technology',
  SOC: 'Social Studies', CMP: 'Computer Science', OMT: 'Optional Mathematics', ACC: 'Accountancy', ECO: 'Economics', PHY: 'Physics',
  CHE: 'Chemistry', BIO: 'Biology', BUS: 'Business Studies', ART: 'Drawing & Rhymes',
};
const FEES: Record<Group, { tuition: number; exam: number; annual: number; computer?: number; lab?: number }> = {
  pre: { tuition: 2200, exam: 500, annual: 4000 },
  low: { tuition: 2600, exam: 700, annual: 4000 },
  mid: { tuition: 2900, exam: 700, annual: 4500, computer: 300 },
  upper: { tuition: 3300, exam: 800, annual: 4500, computer: 300 },
  sec: { tuition: 3800, exam: 900, annual: 5000, computer: 300 },
  sci: { tuition: 6000, exam: 1200, annual: 6000, lab: 500 },
  mgmt: { tuition: 4500, exam: 1200, annual: 6000 },
};

// Staff: [key, first, middle, last, gender, designation, type, dept]
const STAFF = [
  ['principal', 'Ramesh', 'Prasad', 'Adhikari', 'male', 'Principal', 'teaching', 'Administration'],
  ['sita', 'Sita', null, 'Sharma', 'female', 'Secondary Teacher (Mathematics)', 'teaching', 'Mathematics'],
  ['hari', 'Hari', 'Bahadur', 'Thapa', 'male', 'Secondary Teacher (Science)', 'teaching', 'Science'],
  ['gita', 'Gita', null, 'Poudel', 'female', 'Secondary Teacher (English)', 'teaching', 'Languages'],
  ['bishnu', 'Bishnu', 'Prasad', 'Bhattarai', 'male', 'Secondary Teacher (Nepali)', 'teaching', 'Languages'],
  ['kamal', 'Kamal', null, 'Gurung', 'male', 'Secondary Teacher (Social Studies)', 'teaching', 'Social Studies'],
  ['anita', 'Anita', null, 'Shrestha', 'female', 'Computer Teacher', 'teaching', 'Computer'],
  ['pramila', 'Pramila', null, 'KC', 'female', 'Lower Secondary Teacher (Mathematics)', 'teaching', 'Mathematics'],
  ['nabin', 'Nabin', null, 'Ghimire', 'male', 'Primary Teacher (Science)', 'teaching', 'Science'],
  ['puja', 'Puja', null, 'Khanal', 'female', 'Primary Teacher (English)', 'teaching', 'Languages'],
  ['sunita', 'Sunita', null, 'Magar', 'female', 'Primary Teacher', 'teaching', 'Primary'],
  ['rajendra', 'Rajendra', null, 'Chaudhary', 'male', 'Health & PE Teacher', 'teaching', 'Primary'],
  ['laxmi', 'Laxmi', null, 'Pandey', 'female', 'Pre-primary Teacher', 'teaching', 'Pre-primary'],
  ['sarita', 'Sarita', null, 'Aryal', 'female', 'Pre-primary Teacher', 'teaching', 'Pre-primary'],
  ['rita', 'Rita', null, 'Tharu', 'female', 'Pre-primary Teacher', 'teaching', 'Pre-primary'],
  ['suman', 'Suman', null, 'Basnet', 'male', 'Primary Teacher (Social Studies)', 'teaching', 'Social Studies'],
  ['dipak', 'Dipak', null, 'Neupane', 'male', '+2 Lecturer (Physics & Chemistry)', 'teaching', 'Science'],
  ['manoj', 'Manoj', 'Kumar', 'Yadav', 'male', '+2 Lecturer (Management)', 'teaching', 'Management'],
  ['kamala', 'Kamala', null, 'Gautam', 'female', 'Accountant', 'non_teaching', 'Accounts'],
  ['bimala', 'Bimala', null, 'Rana', 'female', 'Office Administrator', 'non_teaching', 'Administration'],
  ['shyam', 'Shyam', null, 'Kunwar', 'male', 'Librarian', 'non_teaching', 'Administration'],
  ['rambdr', 'Ram', 'Bahadur', 'Pun', 'male', 'Office Helper', 'non_teaching', 'Administration'],
] as const;

// Sections: [class name, section name, stream, group, class teacher, students]
const SECTIONS: Array<[string, string, string | null, Group, string, number]> = [
  ['Nursery', 'A', null, 'pre', 'laxmi', 6], ['LKG', 'A', null, 'pre', 'sarita', 6], ['UKG', 'A', null, 'pre', 'rita', 6],
  ['Grade 1', 'A', null, 'low', 'rajendra', 8], ['Grade 2', 'A', null, 'low', 'sunita', 8], ['Grade 3', 'A', null, 'low', 'puja', 8],
  ['Grade 4', 'A', null, 'mid', 'nabin', 8], ['Grade 5', 'A', null, 'mid', 'pramila', 8],
  ['Grade 6', 'A', null, 'upper', 'anita', 8], ['Grade 7', 'A', null, 'upper', 'kamal', 8], ['Grade 8', 'A', null, 'upper', 'gita', 8],
  ['Grade 9', 'A', null, 'sec', 'hari', 8], ['Grade 10', 'A', null, 'sec', 'sita', 8], ['Grade 10', 'B', null, 'sec', 'bishnu', 8],
  ['Grade 11', 'Science', 'Science', 'sci', 'dipak', 7], ['Grade 11', 'Management', 'Management', 'mgmt', 'manoj', 7],
];
/** Who teaches what, by group (pre-primary: the class teacher teaches everything). */
const TEACHES: Record<Exclude<Group, 'pre'>, Record<string, string>> = {
  low: { NEP: 'sunita', ENG: 'puja', MTH: 'pramila', SER: 'suman', HPC: 'rajendra' },
  mid: { NEP: 'sunita', ENG: 'puja', MTH: 'pramila', SCI: 'nabin', SOC: 'suman', HPC: 'rajendra', CMP: 'anita' },
  upper: { NEP: 'bishnu', ENG: 'gita', MTH: 'pramila', SCI: 'hari', SOC: 'kamal', HPC: 'rajendra', CMP: 'anita' },
  sec: { ENG: 'gita', NEP: 'bishnu', MTH: 'sita', SCI: 'hari', SOC: 'kamal', OMT: 'sita', ACC: 'manoj', CMP: 'anita', ECO: 'manoj' },
  sci: { ENG: 'gita', NEP: 'bishnu', PHY: 'dipak', CHE: 'dipak', MTH: 'sita', BIO: 'hari', CMP: 'anita' },
  mgmt: { ENG: 'gita', NEP: 'bishnu', ACC: 'manoj', ECO: 'manoj', BUS: 'manoj', MTH: 'sita', CMP: 'anita' },
};

// ───────────────────────────── main
async function main() {
  const existing = await db.query(`SELECT (SELECT count(*) FROM students)::int AS s, (SELECT count(*) FROM users)::int AS u`);
  if ((existing.rows[0].s > 0 || existing.rows[0].u > 0) && !args.force) {
    throw new Error('Database is not empty. Use `npm run db:demo` (rebuilds it first), or --force to add demo data anyway.');
  }
  const yearRow = (await db.query(`SELECT id, name, start_date, end_date FROM academic_years WHERE is_current`)).rows[0];
  if (!yearRow || yearRow.name !== '2083') throw new Error('Expected the seeded current academic year 2083 — run install.sql first.');
  const yearId: number = yearRow.id;
  if (TODAY < '2026-11-01' || TODAY > yearRow.end_date) console.warn(`! Today is ${TODAY}: the demo timeline is built for mid-2083 (Nov 2026 – Apr 2027).`);
  const past = (d: string) => d <= TODAY;

  // ── admin (direct, like create-admin) and session
  step('Super admin');
  const hash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);
  await db.transaction(null, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO users (username, email, password_hash, must_change_password) VALUES ('admin', 'admin@himalayanmodel.edu.np', $1, FALSE) RETURNING id`,
      [hash],
    );
    await tx.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'super_admin'`, [rows[0].id]);
  });
  await login();

  // ── school profile + logo
  step('School profile & logo');
  await api('PUT', '/school/profile', {
    name: 'Himalayan Model Secondary School', nameNp: 'हिमालयन मोडल माध्यमिक विद्यालय',
    address: 'Butwal-11, Kalikanagar, Rupandehi, Lumbini Province', phone: '071-540123', email: 'info@himalayanmodel.edu.np',
    website: 'https://himalayanmodel.edu.np', panNo: '609876543', schoolCode: '340120045', establishedYear: 2052,
  });
  const logo = readFileSync(new URL('./demo-assets/logo.png', import.meta.url)).toString('base64');
  await api('PUT', '/school/logo', { dataUrl: `data:image/png;base64,${logo}` });

  // ── academic structure
  step('Terms, calendar, subjects');
  const terms = [['First Term', '2026-04-14', '2026-08-16'], ['Second Term', '2026-08-17', '2026-12-15'], ['Third Term', '2026-12-16', '2027-04-13']];
  const termIds: number[] = [];
  for (const [i, [name, startDate, endDate]] of terms.entries()) termIds.push((await api('POST', `/academic/years/${yearId}/terms`, { name, sequence: i + 1, startDate, endDate })).id);
  const calendar: Array<[string, string, string, string, boolean]> = [
    ['Nepali New Year 2083', '2026-04-14', '2026-04-14', 'holiday', true],
    ['Summer Vacation', '2026-06-01', '2026-06-12', 'vacation', true],
    ['First Terminal Examination', '2026-07-26', '2026-08-05', 'exam', false],
    ['Parent–Teacher Meeting', '2026-08-14', '2026-08-14', 'event', false],
    ['Janai Purnima', '2026-08-28', '2026-08-28', 'holiday', true],
    ['Haritalika Teej', '2026-09-14', '2026-09-14', 'holiday', true],
    ['Dashain Vacation', '2026-10-10', '2026-10-25', 'vacation', true],
    ['Tihar Vacation', '2026-11-07', '2026-11-11', 'vacation', true],
    ['Chhath Parva', '2026-11-15', '2026-11-15', 'holiday', true],
    ['Second Terminal Examination', '2026-12-03', '2026-12-12', 'exam', false],
    ['Annual Sports Week', '2026-12-20', '2026-12-23', 'event', false],
    ['Winter Vacation', '2027-01-01', '2027-01-14', 'vacation', true],
    ['Annual Examination', '2027-03-21', '2027-04-02', 'exam', false],
    ['Result Day & Annual Function', '2027-04-09', '2027-04-09', 'event', false],
  ];
  const holidays = new Set<string>();
  for (const [title, startDate, endDate, dayType, isHoliday] of calendar) {
    await api('POST', '/academic/calendar', { academicYearId: yearId, title, startDate, endDate, dayType, isHoliday });
    if (isHoliday) for (let d = startDate; d <= endDate; d = addDays(d, 1)) holidays.add(d);
  }
  const schoolDay = (d: string) => weekday(d) !== 6 && !holidays.has(d);

  const subjectId: Record<string, number> = {};
  for (const [code, name] of Object.entries(SUBJECT_NAMES)) subjectId[code] = (await api('POST', '/academic/subjects', { code, name })).id;
  const classes: Array<{ id: number; name: string }> = (await api('GET', '/academic/classes')).items;
  const streams: Array<{ id: number; name: string }> = (await api('GET', '/academic/streams')).items;
  const classId = (n: string) => classes.find((c) => c.name === n)!.id;
  const streamId = (n: string | null) => (n ? streams.find((s) => s.name === n)!.id : null);

  // ── staff
  step('Staff & departments');
  const deptId: Record<string, number> = {};
  for (const d of new Set(STAFF.map((s) => s[7]))) deptId[d] = (await api('POST', '/staff/departments', { name: d })).id;
  const staffId: Record<string, number> = {};
  for (const [i, [key, firstName, middleName, lastName, gender, designation, staffType, dept]] of STAFF.entries()) {
    const s = await api('POST', '/staff', {
      employeeNo: `HMS-E${String(i + 1).padStart(3, '0')}`, firstName, middleName, lastName, gender, phone: mobile(),
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@himalayanmodel.edu.np`, designation, staffType, departmentId: deptId[dept],
      employmentType: i < 14 || staffType === 'non_teaching' ? 'permanent' : 'contract', dob: `${int(1972, 1996)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
      qualification: staffType === 'teaching' ? pick(['M.Ed.', 'B.Ed.', 'M.Sc.', 'M.A.', 'B.Sc., B.Ed.', 'MBS']) : pick(['BBS', '+2', 'B.A.']),
      teachingLicenseNo: staffType === 'teaching' ? `TL-${digits(6)}` : null, citizenshipNo: `48-01-${digits(2)}-${digits(5)}`, panNo: digits(9),
      bankName: pick(['Global IME Bank', 'Nabil Bank', 'Siddhartha Bank', 'NIC Asia Bank']), bankAccountNo: digits(14),
      joinDate: `${int(2014, 2025)}-${String(int(4, 6)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, address: `${pick(LOCAL)}, Rupandehi`,
      showOnWebsite: staffType === 'teaching', publicBio: key === 'principal' ? 'Leading Himalayan Model since 2071 BS, with 25 years in school education.' : null,
    });
    staffId[key] = s.id;
  }

  // ── sections, curriculum, teachers
  step('Sections, curriculum & teacher assignments');
  interface Sec { id: number; cls: string; name: string; group: Group; classId: number; streamId: number | null; cs: Record<string, { id: number; def: SubjectDef }>; enrollments: Array<{ id: number; studentId: number; ability: number; absentRate: number }> }
  const sections: Sec[] = [];
  const csCache = new Map<string, Sec['cs']>();
  for (const [cls, name, stream, group, teacher] of SECTIONS) {
    const sec = await api('POST', '/academic/sections', { academicYearId: yearId, classId: classId(cls), streamId: streamId(stream), name, classTeacherId: staffId[teacher], capacity: group === 'sci' || group === 'mgmt' ? 48 : 40 });
    const ck = `${cls}|${stream}`;
    if (!csCache.has(ck)) {
      const cs: Sec['cs'] = {};
      for (const [i, def] of SUBJECTS[group].entries()) {
        const row = await api('POST', '/academic/class-subjects', { academicYearId: yearId, classId: classId(cls), streamId: streamId(stream), subjectId: subjectId[def.code], creditHours: def.ch, isOptional: !!def.optional, optionalGroup: def.optional ?? null, sequence: i + 1 });
        cs[def.code] = { id: row.id, def };
      }
      csCache.set(ck, cs);
    }
    const s: Sec = { id: sec.id, cls, name, group, classId: classId(cls), streamId: streamId(stream), cs: csCache.get(ck)!, enrollments: [] };
    sections.push(s);
    for (const [code, { id: csId }] of Object.entries(s.cs)) {
      const who = group === 'pre' ? teacher : TEACHES[group][code];
      await api('POST', '/academic/teacher-assignments', { sectionId: s.id, classSubjectId: csId, staffId: staffId[who] });
    }
  }

  // ── students & families
  step('Students, guardians & enrollment');
  const levelOf = (cls: string) => (cls === 'Nursery' ? -2 : cls === 'LKG' ? -1 : cls === 'UKG' ? 0 : Number(cls.split(' ')[1]));
  interface Family { surname: string; father: number; mother?: number; children: number }
  const families: Family[] = [];
  let admissionSeq = 0;
  const demo: { parentGuardianId?: number; studentId?: number } = {};
  const demoKids: Record<string, { first: string; gender: 'male' | 'female' }> = { 'Grade 7|A': { first: 'Aarav', gender: 'male' }, 'Grade 3|A': { first: 'Smriti', gender: 'female' } };
  let demoFamily: Family | undefined;

  for (const sec of sections) {
    const size = SECTIONS.find((x) => x[0] === sec.cls && x[1] === sec.name)![5];
    const level = levelOf(sec.cls);
    for (let i = 0; i < size; i++) {
      const fixed = i === 0 ? demoKids[`${sec.cls}|${sec.name}`] : undefined;
      const gender = fixed?.gender ?? (chance(0.5) ? 'male' : 'female');
      // ~15% are siblings of an earlier student
      let family: Family | undefined = fixed ? demoFamily : families.length > 6 && chance(0.15) ? pick(families.filter((f) => f.children < 3)) : undefined;
      const surname = fixed ? 'Gurung' : (family?.surname ?? pick(SURNAMES));
      const yearsHere = Math.max(0, Math.min(level + 2, int(0, 6)));
      const student = await api('POST', '/students', {
        admissionNo: `HMS-${String(++admissionSeq).padStart(4, '0')}`,
        firstName: fixed?.first ?? pick(gender === 'male' ? MALE : FEMALE), lastName: surname, gender,
        dob: `${2026 - (level + 6) - (chance(0.25) ? 1 : 0)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
        bloodGroup: chance(0.8) ? pick(BLOOD) : null, religion: chance(0.82) ? 'Hindu' : pick(['Buddhist', 'Buddhist', 'Christian', 'Kirat']),
        motherTongue: TONGUE[surname] && chance(0.7) ? TONGUE[surname] : 'Nepali', nationality: 'Nepali',
        province: 'Lumbini', district: chance(0.88) ? 'Rupandehi' : pick(['Palpa', 'Nawalparasi West', 'Kapilvastu']), localLevel: pick(LOCAL), wardNo: int(1, 17), tole: pick(TOLES),
        phone: level >= 9 && chance(0.6) ? mobile() : null, admissionDate: `${2026 - yearsHere}-04-${String(int(15, 28)).padStart(2, '0')}`,
        previousSchool: yearsHere === 0 && level > 0 ? pick(['Shree Kalika Secondary School', 'Bal Jyoti English School', 'Lumbini Academy', 'Shree Janata Secondary School']) : null,
      });
      if (family) {
        await api('POST', `/students/${student.id}/guardians`, { guardianId: family.father, relation: 'father', isPrimary: true });
        if (family.mother) await api('POST', `/students/${student.id}/guardians`, { guardianId: family.mother, relation: 'mother', isPrimary: false });
        family.children++;
      } else {
        const fatherName = fixed ? 'Dil Bahadur Gurung' : `${pick(FATHERS)} ${surname}`;
        const g = await api('POST', `/students/${student.id}/guardians`, {
          relation: 'father', isPrimary: true,
          guardian: { fullName: fatherName, phone: mobile(), occupation: pick(JOBS.slice(0, 13)), address: `${pick(TOLES)}, ${pick(LOCAL)}`, email: chance(0.3) ? `${fatherName.split(' ')[0].toLowerCase()}${int(10, 99)}@gmail.com` : null },
        });
        family = { surname, father: g.guardianId, children: 1 };
        if (fixed || chance(0.35)) {
          const m = await api('POST', `/students/${student.id}/guardians`, { relation: 'mother', isPrimary: false, guardian: { fullName: fixed ? 'Kalpana Gurung' : `${pick(MOTHERS)} ${surname}`, phone: mobile(), occupation: pick(JOBS) } });
          family.mother = m.guardianId;
        }
        families.push(family);
        if (fixed) {
          demoFamily = family;
          demo.parentGuardianId = family.father;
        }
      }
      if (fixed?.first === 'Aarav') demo.studentId = student.id;
      const e = await api('POST', '/enrollments', { studentId: student.id, sectionId: sec.id, symbolNo: sec.cls === 'Grade 10' ? `0251${digits(4)}` : null });
      sec.enrollments.push({ id: e.id, studentId: student.id, ability: clamp(0.68 + gauss() * 0.13, 0.36, 0.98), absentRate: clamp(0.04 + gauss() * 0.03, 0.005, 0.15) });
    }
    await api('POST', `/enrollments/sections/${sec.id}/assign-roll-numbers`);
    // optional subjects: exactly one per group (Grade 9–11)
    const groups = new Map<string, number[]>();
    for (const { id, def } of Object.values(sec.cs)) if (def.optional) groups.set(def.optional, [...(groups.get(def.optional) ?? []), id]);
    if (groups.size) for (const e of sec.enrollments) await api('PUT', `/enrollments/${e.id}/subjects`, { classSubjectIds: [...groups.values()].map((ids) => pick(ids)) });
  }
  const allEnrollments = sections.flatMap((s) => s.enrollments.map((e) => ({ ...e, sec: s })));

  // ── accounts
  step('Login accounts');
  await api('POST', `/staff/${staffId.principal}/account`, { username: 'principal', roles: ['admin_staff'] });
  const principalUser = (await db.query(`SELECT id FROM users WHERE username = 'principal'`)).rows[0].id;
  await api('PUT', `/users/${principalUser}/roles`, { roles: ['principal'] });
  await api('POST', `/staff/${staffId.bimala}/account`, { username: 'office', roles: ['admin_staff'] });
  await api('POST', `/staff/${staffId.kamala}/account`, { username: 'accountant', roles: ['accountant'] });
  await api('POST', `/staff/${staffId.sita}/account`, { username: 'teacher', roles: ['teacher'] });
  await api('POST', `/staff/${staffId.shyam}/account`, { username: 'librarian', roles: ['librarian'] });
  await api('POST', `/guardians/${demo.parentGuardianId}/account`, { username: 'parent' });
  await api('POST', `/students/${demo.studentId}/account`, { username: 'student' });
  const demoUsers = ['principal', 'office', 'accountant', 'teacher', 'librarian', 'parent', 'student'];
  await db.query(`UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE username = ANY($2)`, [hash, demoUsers]);
  const accounts = [
    ['Super admin', 'admin'], ['Principal', 'principal'], ['Office admin', 'office'], ['Accountant', 'accountant'],
    ['Teacher', 'teacher'], ['Parent', 'parent'], ['Student', 'student'],
  ].map(([role, username]) => ({ role, username, password: DEMO_PASSWORD }));
  await db.query(
    `INSERT INTO settings (key, value, description) VALUES ('demo_accounts', $1, 'Demo database: logins shown on the sign-in screen. Removed by db:reset.')`,
    [JSON.stringify(accounts)],
  );

  // ── fees
  step('Fee structures & discounts');
  const feeTypes: Array<{ id: number; code: string }> = (await api('GET', '/fees/types')).items;
  const ft = (code: string) => feeTypes.find((f) => f.code === code)!.id;
  const doneStructure = new Set<string>();
  for (const s of sections) {
    const k = `${s.classId}|${s.streamId}`;
    if (doneStructure.has(k)) continue;
    doneStructure.add(k);
    const f = FEES[s.group];
    const base = { academicYearId: yearId, classId: s.classId, streamId: s.streamId };
    await api('POST', '/fees/structures', { ...base, feeTypeId: ft('TUITION'), amount: f.tuition, frequency: 'monthly', dueDay: 15 });
    await api('POST', '/fees/structures', { ...base, feeTypeId: ft('EXAM'), amount: f.exam, frequency: 'termly' });
    await api('POST', '/fees/structures', { ...base, feeTypeId: ft('ANNUAL'), amount: f.annual, frequency: 'yearly' });
    if (f.computer) await api('POST', '/fees/structures', { ...base, feeTypeId: ft('COMPUTER'), amount: f.computer, frequency: 'monthly', dueDay: 15 });
    if (f.lab) await api('POST', '/fees/structures', { ...base, feeTypeId: ft('LAB'), amount: f.lab, frequency: 'monthly', dueDay: 15 });
  }
  // sibling discount for 2nd+ children, the legally required scholarship quota, and one merit award
  const seenFamily = new Set<number>();
  const guardianOfStudent = new Map<number, number>();
  for (const r of (await db.query(`SELECT student_id, guardian_id FROM student_guardians WHERE is_primary`)).rows) guardianOfStudent.set(r.student_id, r.guardian_id);
  for (const e of [...allEnrollments].sort((a, b) => levelOf(b.sec.cls) - levelOf(a.sec.cls))) {
    const g = guardianOfStudent.get(e.studentId)!;
    if (seenFamily.has(g)) await api('POST', '/fees/discounts', { enrollmentId: e.id, feeTypeId: ft('TUITION'), discountType: 'percent', value: 10, reason: 'sibling' });
    seenFamily.add(g);
  }
  const scholars = new Set<number>();
  while (scholars.size < 8) scholars.add(pick(allEnrollments.filter((e) => levelOf(e.sec.cls) >= 1)).id);
  for (const id of scholars) await api('POST', '/fees/discounts', { enrollmentId: id, feeTypeId: ft('TUITION'), discountType: 'percent', value: pick([50, 100]), reason: 'scholarship' });
  const topG10 = allEnrollments.filter((e) => e.sec.cls === 'Grade 10' && !scholars.has(e.id)).sort((a, b) => b.ability - a.ability)[0];
  await api('POST', '/fees/discounts', { enrollmentId: topG10.id, feeTypeId: ft('TUITION'), discountType: 'percent', value: 25, reason: 'merit' });

  step('Monthly invoices');
  for (const [month, start] of MONTHS.filter(([, d]) => past(d))) {
    const frequencies = month === 'Baisakh' ? ['monthly', 'yearly', 'termly'] : month === 'Bhadra' || month === 'Poush' ? ['monthly', 'termly'] : ['monthly'];
    await api('POST', '/fees/invoices/generate', { academicYearId: yearId, billingPeriod: `2083-${month}`, frequencies, issueDate: start, dueDate: addDays(start, 14) });
  }

  step('Fee payments');
  const METHODS: Array<[string, number]> = [['cash', 0.58], ['esewa', 0.12], ['khalti', 0.07], ['fonepay', 0.12], ['bank_deposit', 0.11]];
  const method = () => {
    let r = rand();
    for (const [m, p] of METHODS) if ((r -= p) < 0) return m;
    return 'cash';
  };
  const ref = (m: string) => (m === 'cash' ? null : m === 'bank_deposit' ? `GIBL-${digits(8)}` : `${m.slice(0, 2).toUpperCase()}${digits(10)}`);
  let payToday = 0;
  for (const e of allEnrollments) {
    const invoices: Array<{ issueDate: string; totalAmount: number }> = (await api('GET', `/fees/students/${e.studentId}/invoices?pageSize=100`)).items;
    invoices.sort((a, b) => a.issueDate.localeCompare(b.issueDate));
    const profile = rand();
    // pay-dates: prompt payers each month; others before Dashain/at quarter ends; a few fall behind
    let dates: string[];
    if (profile < 0.62) dates = invoices.map((i) => addDays(i.issueDate, int(0, 12)));
    else if (profile < 0.85) dates = ['2026-04-20', '2026-07-20', '2026-10-05', '2026-11-18'].map((d) => addDays(d, int(0, 3)));
    else dates = ['2026-04-22', '2026-06-20', '2026-09-01'].map((d) => addDays(d, int(0, 4)));
    if (payToday < 4 && profile < 0.62 && chance(0.2)) dates[dates.length - 1] = TODAY;
    let paid = 0;
    for (let d of dates) {
      if (weekday(d) === 6) d = addDays(d, 1);
      if (!past(d)) continue;
      let due = invoices.filter((i) => i.issueDate <= d).reduce((s, i) => s + i.totalAmount, 0) - paid;
      if (profile >= 0.85 && d >= '2026-09-01') due = Math.round(due * 0.4); // fell behind: part payment only
      if (due <= 0) continue;
      const m = method();
      await api('POST', '/fees/receipts', { studentId: e.studentId, amount: due, method: m, referenceNo: ref(m), paymentDate: d });
      paid += due;
      if (d === TODAY) payToday++;
    }
  }

  // ── exams
  step('First Terminal Examination: schedules, marks, results');
  const components = (def: SubjectDef, group: Group) => {
    const th = group === 'pre' ? 50 : group === 'low' ? 50 : def.practical ? (group === 'sec' || group === 'sci' || group === 'mgmt' ? 75 : 50) : 75;
    const other = 100 - th;
    const otherType = group === 'pre' ? 'oral' : def.practical ? 'practical' : 'internal';
    return [
      { name: 'Theory', componentType: 'theory', fullMarks: th, passMarks: Math.round(th * 0.35 * 100) / 100, creditHours: Math.round(def.ch * (th / 100) * 100) / 100 },
      { name: otherType === 'oral' ? 'Oral' : otherType === 'practical' ? 'Practical' : 'Internal', componentType: otherType, fullMarks: other, passMarks: 0, creditHours: Math.round(def.ch * (other / 100) * 100) / 100 },
    ];
  };
  async function scheduleExam(examId: number, firstDay: string, sectionsToSchedule: Sec[]) {
    const comp: CompMap = new Map(); // classSubjectId → components
    const scheduled = new Set<number>();
    for (const s of sectionsToSchedule) {
      let day = firstDay;
      for (const { id: csId, def } of Object.values(s.cs)) {
        while (!schoolDay(day)) day = addDays(day, 1);
        if (!scheduled.has(csId)) {
          const sch = await api('POST', `/exams/${examId}/schedules`, { classSubjectId: csId, examDate: day, startTime: s.group === 'pre' || s.group === 'low' ? '10:00' : '11:00', endTime: s.group === 'pre' || s.group === 'low' ? '12:00' : '14:00', components: components(def, s.group) });
          comp.set(csId, sch.components);
          scheduled.add(csId);
        }
        day = addDays(day, 1);
      }
    }
    return comp;
  }
  async function enterMarks(comp: CompMap, s: Sec, examBias = 0, onlyCodes?: string[]) {
    for (const { id: csId, def } of Object.values(s.cs)) {
      if (onlyCodes && !onlyCodes.includes(def.code)) continue;
      const subjectBias = gauss() * 0.05;
      for (const c of comp.get(csId) ?? []) {
        const roster: Array<{ enrollmentId: number }> = (await api('GET', `/exams/components/${c.id}/marks?sectionId=${s.id}`)).items;
        const entries = roster.map(({ enrollmentId }) => {
          const e = s.enrollments.find((x) => x.id === enrollmentId)!;
          if (c.componentType === 'theory' && chance(0.002)) return { enrollmentId, marksObtained: null, isAbsent: true };
          const pct = c.componentType === 'theory' ? e.ability + examBias + subjectBias + gauss() * 0.08 : Math.max(e.ability, 0.6) + 0.15 + gauss() * 0.05;
          return { enrollmentId, marksObtained: Math.round(clamp(pct, 0.08, 1) * c.fullMarks), isAbsent: false };
        });
        if (entries.length) await api('PUT', `/exams/components/${c.id}/marks`, { sectionId: s.id, entries });
      }
    }
  }
  const ft1 = await api('POST', '/exams', { academicYearId: yearId, termId: termIds[0], name: 'First Terminal Examination 2083', examType: 'terminal', startDate: '2026-07-26', endDate: '2026-08-05' });
  const comp1 = await scheduleExam(ft1.id, '2026-07-26', sections);
  for (const s of sections) {
    await enterMarks(comp1, s);
    await api('POST', `/exams/${ft1.id}/verify`, { sectionId: s.id });
    await api('POST', `/exams/${ft1.id}/process`, { sectionId: s.id, force: false });
  }
  await api('POST', `/exams/${ft1.id}/publish`, { published: true });

  step('Second Terminal Examination: scheduled, marks entry in progress');
  const ft2 = await api('POST', '/exams', { academicYearId: yearId, termId: termIds[1], name: 'Second Terminal Examination 2083', examType: 'terminal', startDate: '2026-12-03', endDate: '2026-12-12' });
  const comp2 = await scheduleExam(ft2.id, '2026-12-03', sections);
  // early internal-assessment entry for Grade 10 A English & Nepali — Mathematics is left for the demo teacher
  const g10a = sections.find((s) => s.cls === 'Grade 10' && s.name === 'A')!;
  await enterMarks(comp2, g10a, 0.02, ['ENG', 'NEP']);

  // ── attendance
  step('Daily attendance (students & staff)');
  const staffIds = Object.values(staffId);
  const lazyToday = new Set(sections.slice(-3).map((s) => s.id)); // a few sections not yet marked today
  let days = 0;
  for (let d = '2026-04-15'; d <= TODAY; d = addDays(d, 1)) {
    if (!schoolDay(d)) continue;
    days++;
    for (const s of sections) {
      if (d === TODAY && lazyToday.has(s.id)) continue;
      const records = s.enrollments.map((e) => {
        const r = rand();
        if (r < e.absentRate) return { enrollmentId: e.id, status: 'absent' };
        if (r < e.absentRate + 0.025) return { enrollmentId: e.id, status: 'late' };
        if (r < e.absentRate + 0.033) return { enrollmentId: e.id, status: 'leave', remarks: pick(['Family function', 'Sick', 'Out of town']) };
        return { enrollmentId: e.id, status: 'present' };
      });
      await api('PUT', `/attendance/sections/${s.id}`, { date: d, records });
    }
    await api('PUT', '/attendance/staff', {
      date: d,
      records: staffIds.map((id) => (chance(0.03) ? { staffId: id, status: 'leave' } : { staffId: id, status: chance(0.06) ? 'late' : 'present', checkIn: `09:${String(int(30, 59)).padStart(2, '0')}`, checkOut: `16:${String(int(0, 30)).padStart(2, '0')}` })),
    });
  }

  const counts = (await db.query(`SELECT (SELECT count(*) FROM students)::int s, (SELECT count(*) FROM staff)::int st, (SELECT count(*) FROM invoices)::int i, (SELECT count(*) FROM receipts)::int r, (SELECT count(*) FROM marks)::int m`)).rows[0];
  console.log(`\n✔ Demo school ready in ${Math.round((Date.now() - t0) / 1000)}s (${calls} API calls)`);
  console.log(`  ${counts.s} students · ${counts.st} staff · ${counts.i} invoices · ${counts.r} receipts · ${counts.m} marks · ${days} school days of attendance`);
  console.log(`\n  Sign in with any of these (password: ${DEMO_PASSWORD}):`);
  for (const a of accounts) console.log(`    ${a.role.padEnd(13)} ${a.username}`);
}

try {
  await main();
} catch (err) {
  console.error(`\n✘ Demo seed failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
