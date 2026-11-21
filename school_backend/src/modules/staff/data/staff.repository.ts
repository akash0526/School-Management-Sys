import type { Database, Queryable } from '../../../shared/db/database.js';
import { buildInsert, buildUpdate, type ColumnMap, rowsToCamel, toCamel, containsPattern } from '../../../shared/db/sql.js';
import type { StaffInput, StaffMember, StaffRepository } from '../business/staff.ports.js';

const COLUMNS: ColumnMap<StaffInput> = {
  employeeNo: 'employee_no',
  firstName: 'first_name',
  middleName: 'middle_name',
  lastName: 'last_name',
  fullNameNp: 'full_name_np',
  gender: 'gender',
  dob: 'dob',
  phone: 'phone',
  email: 'email',
  address: 'address',
  departmentId: 'department_id',
  designation: 'designation',
  staffType: 'staff_type',
  employmentType: 'employment_type',
  qualification: 'qualification',
  teachingLicenseNo: 'teaching_license_no',
  citizenshipNo: 'citizenship_no',
  panNo: 'pan_no',
  bankName: 'bank_name',
  bankAccountNo: 'bank_account_no',
  photoUrl: 'photo_url',
  joinDate: 'join_date',
  leaveDate: 'leave_date',
  status: 'status',
  showOnWebsite: 'show_on_website',
  publicBio: 'public_bio',
  websiteOrder: 'website_order',
  customFields: 'custom_fields',
};

/** DATA LAYER — staff SQL. */
export class PgStaffRepository implements StaffRepository {
  constructor(private readonly db: Database) {}

  async list(f: { search?: string; departmentId?: number; staffType?: string; status?: string; limit: number; offset: number }) {
    const params: unknown[] = [];
    const where = ['s.deleted_at IS NULL'];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (f.search) add(`(s.employee_no ILIKE ? OR (s.first_name || ' ' || s.last_name) ILIKE ?)`, containsPattern(f.search));
    if (f.departmentId) add('s.department_id = ?', f.departmentId);
    if (f.staffType) add('s.staff_type = ?', f.staffType);
    if (f.status) add('s.status = ?', f.status);
    const w = where.join(' AND ');
    const total = await this.db.query(`SELECT count(*)::int AS n FROM staff s WHERE ${w}`, params);
    params.push(f.limit, f.offset);
    const { rows } = await this.db.query(
      `SELECT s.*, d.name AS department_name FROM staff s LEFT JOIN departments d ON d.id = s.department_id
        WHERE ${w} ORDER BY s.first_name, s.last_name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel<StaffMember>(rows), total: total.rows[0].n as number };
  }

  async findById(id: number, q: Queryable = this.db) {
    const { rows } = await q.query(
      `SELECT s.*, d.name AS department_name FROM staff s LEFT JOIN departments d ON d.id = s.department_id
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [id],
    );
    return rows[0] ? toCamel<StaffMember>(rows[0]) : null;
  }

  async findIdByUserId(userId: number) {
    const { rows } = await this.db.query(`SELECT id FROM staff WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
    return (rows[0]?.id as number) ?? null;
  }

  async create(input: StaffInput, q: Queryable = this.db) {
    const { text, values } = buildInsert('staff', COLUMNS, input);
    const { rows } = await q.query(text, values);
    return toCamel<StaffMember>(rows[0]);
  }

  async update(id: number, input: Partial<StaffInput>, q: Queryable = this.db) {
    const sql = buildUpdate('staff', COLUMNS, input, id, 'AND deleted_at IS NULL');
    if (!sql) return this.findById(id, q);
    const { rows } = await q.query(sql.text, sql.values);
    return rows[0] ? toCamel<StaffMember>(rows[0]) : null;
  }

  async setUserId(staffId: number, userId: number, q: Queryable) {
    await q.query(`UPDATE staff SET user_id = $2 WHERE id = $1`, [staffId, userId]);
  }

  async listDepartments() {
    const { rows } = await this.db.query(`SELECT id, name, head_staff_id FROM departments ORDER BY name`);
    return rowsToCamel(rows);
  }

  async createDepartment(name: string, q: Queryable = this.db) {
    const { rows } = await q.query(`INSERT INTO departments (name) VALUES ($1) RETURNING id, name`, [name]);
    return toCamel(rows[0]);
  }
}
