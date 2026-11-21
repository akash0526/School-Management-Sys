import type { Database, Queryable } from '../../../shared/db/database.js';
import { rowsToCamel, toCamel } from '../../../shared/db/sql.js';
import type { BillableEnrollment, DiscountRow, FeesSummary, FeeStructureRow, FeesRepository, Frequency, OpenInvoice, PaymentMethod } from '../business/fees.ports.js';

/** DATA LAYER — fees SQL. Money integrity is also enforced by DB triggers. */
export class PgFeesRepository implements FeesRepository {
  constructor(private readonly db: Database) {}

  async listFeeTypes() {
    return rowsToCamel((await this.db.query(`SELECT * FROM fee_types WHERE is_active ORDER BY name`)).rows);
  }
  async createFeeType(f: { code: string; name: string; isRefundable?: boolean }, q: Queryable) {
    const { rows } = await q.query(`INSERT INTO fee_types (code, name, is_refundable) VALUES ($1,$2,$3) RETURNING *`, [f.code.toUpperCase(), f.name, f.isRefundable ?? false]);
    return toCamel(rows[0]);
  }
  async listStructures(academicYearId: number, classId?: number) {
    const { rows } = await this.db.query(
      `SELECT fs.*, ft.code AS fee_type_code, ft.name AS fee_type_name, c.name AS class_name, st.name AS stream_name
         FROM fee_structures fs
         JOIN fee_types ft ON ft.id = fs.fee_type_id
         JOIN classes c ON c.id = fs.class_id
         LEFT JOIN streams st ON st.id = fs.stream_id
        WHERE fs.academic_year_id = $1 AND ($2::int IS NULL OR fs.class_id = $2)
        ORDER BY c.numeric_level, ft.name`,
      [academicYearId, classId ?? null],
    );
    return rowsToCamel(rows);
  }
  async createStructure(s: { academicYearId: number; classId: number; streamId?: number | null; feeTypeId: number; amount: number; frequency: Frequency; dueDay?: number | null }, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO fee_structures (academic_year_id, class_id, stream_id, fee_type_id, amount, frequency, due_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [s.academicYearId, s.classId, s.streamId ?? null, s.feeTypeId, s.amount, s.frequency, s.dueDay ?? null],
    );
    return toCamel(rows[0]);
  }
  async createDiscount(d: { enrollmentId: number; feeTypeId?: number | null; discountType: 'percent' | 'fixed'; value: number; reason: string; validFrom?: string | null; validTo?: string | null; approvedBy: number }, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO student_discounts (enrollment_id, fee_type_id, discount_type, value, reason, valid_from, valid_to, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [d.enrollmentId, d.feeTypeId ?? null, d.discountType, d.value, d.reason, d.validFrom ?? null, d.validTo ?? null, d.approvedBy],
    );
    return toCamel(rows[0]);
  }
  async listDiscounts(enrollmentId: number) {
    const { rows } = await this.db.query(
      `SELECT d.*, ft.name AS fee_type_name FROM student_discounts d LEFT JOIN fee_types ft ON ft.id = d.fee_type_id
        WHERE d.enrollment_id = $1 ORDER BY d.created_at`,
      [enrollmentId],
    );
    return rowsToCamel(rows);
  }

  async getTextSetting(key: string) {
    const { rows } = await this.db.query(`SELECT value #>> '{}' AS v FROM settings WHERE key = $1`, [key]);
    return (rows[0]?.v as string) ?? null;
  }
  async getYearName(academicYearId: number) {
    const { rows } = await this.db.query(`SELECT name FROM academic_years WHERE id = $1`, [academicYearId]);
    return (rows[0]?.name as string) ?? null;
  }
  async billableEnrollments(f: { academicYearId: number; classId?: number; sectionId?: number }) {
    const { rows } = await this.db.query(
      `SELECT e.id AS enrollment_id, e.student_id, sec.class_id, sec.stream_id
         FROM enrollments e JOIN sections sec ON sec.id = e.section_id
        WHERE e.academic_year_id = $1 AND e.status = 'studying'
          AND ($2::int IS NULL OR sec.class_id = $2) AND ($3::int IS NULL OR e.section_id = $3)
        ORDER BY e.id`,
      [f.academicYearId, f.classId ?? null, f.sectionId ?? null],
    );
    return rowsToCamel<BillableEnrollment>(rows);
  }
  async structuresFor(academicYearId: number, frequencies: Frequency[], feeTypeIds?: number[]) {
    const { rows } = await this.db.query(
      `SELECT fs.class_id, fs.stream_id, fs.fee_type_id, ft.name AS fee_type_name, fs.amount
         FROM fee_structures fs JOIN fee_types ft ON ft.id = fs.fee_type_id AND ft.is_active
        WHERE fs.academic_year_id = $1 AND fs.frequency = ANY($2::text[])
          AND ($3::int[] IS NULL OR fs.fee_type_id = ANY($3::int[]))`,
      [academicYearId, frequencies, feeTypeIds?.length ? feeTypeIds : null],
    );
    return rowsToCamel<FeeStructureRow>(rows);
  }
  async discountsFor(enrollmentIds: number[], onDate: string) {
    const { rows } = await this.db.query(
      `SELECT enrollment_id, fee_type_id, discount_type, value FROM student_discounts
        WHERE enrollment_id = ANY($1::bigint[])
          AND (valid_from IS NULL OR valid_from <= $2) AND (valid_to IS NULL OR valid_to >= $2)`,
      [enrollmentIds, onDate],
    );
    return rowsToCamel<DiscountRow>(rows);
  }
  async enrollmentsAlreadyBilled(enrollmentIds: number[], billingPeriod: string) {
    const { rows } = await this.db.query(
      `SELECT DISTINCT enrollment_id FROM invoices
        WHERE enrollment_id = ANY($1::bigint[]) AND billing_period = $2 AND status <> 'cancelled'`,
      [enrollmentIds, billingPeriod],
    );
    return new Set(rows.map((r) => r.enrollment_id as number));
  }
  async nextInvoiceSeq(q: Queryable) {
    return (await q.query(`SELECT nextval('invoice_no_seq') AS n`)).rows[0].n as number;
  }
  async nextReceiptSeq(q: Queryable) {
    return (await q.query(`SELECT nextval('receipt_no_seq') AS n`)).rows[0].n as number;
  }

  async createInvoice(
    inv: { invoiceNo: string; enrollmentId: number; billingPeriod: string; issueDate: string; dueDate: string | null; createdBy: number },
    items: Array<{ feeTypeId: number; description: string; amount: number; discount: number }>,
    q: Queryable,
  ) {
    const { rows } = await q.query(
      `INSERT INTO invoices (invoice_no, enrollment_id, billing_period, issue_date, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [inv.invoiceNo, inv.enrollmentId, inv.billingPeriod, inv.issueDate, inv.dueDate, inv.createdBy],
    );
    const id = rows[0].id as number;
    await q.query(
      `INSERT INTO invoice_items (invoice_id, fee_type_id, description, amount, discount)
       SELECT $1, x.fee_type_id, x.description, x.amount, x.discount
         FROM jsonb_to_recordset($2::jsonb) AS x(fee_type_id int, description text, amount numeric, discount numeric)`,
      [id, JSON.stringify(items.map((i) => ({ fee_type_id: i.feeTypeId, description: i.description, amount: i.amount, discount: i.discount })))],
    );
    // totals were calculated by the DB trigger
    const total = await q.query(`SELECT total_amount FROM invoices WHERE id = $1`, [id]);
    return { id, totalAmount: total.rows[0].total_amount as number };
  }

  async addLedgerEntry(
    e: { studentId: number; enrollmentId?: number | null; entryDate: string; entryType: string; invoiceId?: number | null; receiptId?: number | null; debit?: number; credit?: number; remarks?: string | null; createdBy: number },
    q: Queryable,
  ) {
    await q.query(
      `INSERT INTO student_ledger (student_id, enrollment_id, entry_date, entry_type, invoice_id, receipt_id, debit, credit, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.studentId, e.enrollmentId ?? null, e.entryDate, e.entryType, e.invoiceId ?? null, e.receiptId ?? null, e.debit ?? 0, e.credit ?? 0, e.remarks ?? null, e.createdBy],
    );
  }

  async summary(today: string) {
    const { rows } = await this.db.query(
      `SELECT
         COALESCE(sum(i.total_amount - i.paid_amount) FILTER (WHERE i.status IN ('unpaid','partial')), 0)                       AS outstanding_amount,
         count(*) FILTER (WHERE i.status IN ('unpaid','partial'))::int                                                       AS open_invoices,
         count(DISTINCT e.student_id) FILTER (WHERE i.status IN ('unpaid','partial'))::int                                    AS students_with_dues,
         COALESCE(sum(i.total_amount - i.paid_amount) FILTER (WHERE i.status IN ('unpaid','partial') AND i.due_date < $1::date), 0) AS overdue_amount,
         count(*) FILTER (WHERE i.status IN ('unpaid','partial') AND i.due_date < $1::date)::int                              AS overdue_invoices,
         (SELECT COALESCE(sum(amount), 0) FROM receipts WHERE status = 'valid' AND payment_date = $1::date)                    AS collected_today,
         (SELECT count(*)::int FROM receipts WHERE status = 'valid' AND payment_date = $1::date)                               AS receipts_today,
         (SELECT COALESCE(sum(amount), 0) FROM receipts WHERE status = 'valid' AND payment_date > $1::date - 30)              AS collected_last30_days
       FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id`,
      [today],
    );
    return toCamel<FeesSummary>(rows[0]);
  }

  async listInvoices(f: { studentId?: number; sectionId?: number; status?: string; billingPeriod?: string; limit: number; offset: number }) {
    const params: unknown[] = [];
    const where: string[] = ['TRUE'];
    if (f.studentId) where.push(`e.student_id = $${params.push(f.studentId)}`);
    if (f.sectionId) where.push(`e.section_id = $${params.push(f.sectionId)}`);
    if (f.status) where.push(`i.status = $${params.push(f.status)}`);
    if (f.billingPeriod) where.push(`i.billing_period = $${params.push(f.billingPeriod)}`);
    const w = where.join(' AND ');
    const total = await this.db.query(`SELECT count(*)::int AS n FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id WHERE ${w}`, params);
    params.push(f.limit, f.offset);
    const { rows } = await this.db.query(
      `SELECT i.id, i.invoice_no, i.billing_period, i.issue_date, i.due_date, i.subtotal, i.discount_total, i.fine_total,
              i.total_amount, i.paid_amount, (i.total_amount - i.paid_amount) AS due_amount, i.status,
              e.student_id, s.admission_no, concat_ws(' ', s.first_name, s.last_name) AS student_name
         FROM invoices i
         JOIN enrollments e ON e.id = i.enrollment_id
         JOIN students s ON s.id = e.student_id
        WHERE ${w}
        ORDER BY i.issue_date DESC, i.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: total.rows[0].n as number };
  }

  async getInvoice(id: number) {
    const { rows } = await this.db.query(
      `SELECT i.*, e.student_id, s.admission_no, concat_ws(' ', s.first_name, s.last_name) AS student_name,
              (SELECT COALESCE(json_agg(json_build_object('feeTypeId', it.fee_type_id, 'description', it.description,
                       'amount', it.amount, 'discount', it.discount, 'netAmount', it.net_amount) ORDER BY it.id), '[]')
                 FROM invoice_items it WHERE it.invoice_id = i.id) AS items,
              (SELECT COALESCE(json_agg(json_build_object('receiptId', r.id, 'receiptNo', r.receipt_no, 'amount', pa.amount,
                       'paymentDate', r.payment_date, 'status', r.status) ORDER BY r.payment_date), '[]')
                 FROM payment_allocations pa JOIN receipts r ON r.id = pa.receipt_id WHERE pa.invoice_id = i.id) AS payments
         FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id JOIN students s ON s.id = e.student_id
        WHERE i.id = $1`,
      [id],
    );
    return rows[0] ? toCamel<Record<string, unknown> & { studentId: number }>(rows[0]) : null;
  }

  async getInvoiceForUpdate(id: number, q: Queryable) {
    const { rows } = await q.query(
      `SELECT i.id, e.student_id, i.enrollment_id, i.status, i.total_amount, i.paid_amount
         FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id WHERE i.id = $1 FOR UPDATE OF i`,
      [id],
    );
    return rows[0] ? toCamel<{ id: number; studentId: number; enrollmentId: number; status: string; totalAmount: number; paidAmount: number }>(rows[0]) : null;
  }

  async cancelInvoice(id: number, reason: string, q: Queryable) {
    await q.query(`UPDATE invoices SET status = 'cancelled', notes = concat_ws(E'\\n', notes, $2::text) WHERE id = $1`, [id, `Cancelled: ${reason}`]);
  }

  async openInvoicesForStudent(studentId: number, q: Queryable) {
    const { rows } = await q.query(
      `SELECT i.id, i.total_amount, i.paid_amount
         FROM invoices i JOIN enrollments e ON e.id = i.enrollment_id
        WHERE e.student_id = $1 AND i.status IN ('unpaid', 'partial')
        ORDER BY i.due_date NULLS LAST, i.issue_date, i.id
        FOR UPDATE OF i`,
      [studentId],
    );
    return rowsToCamel<OpenInvoice>(rows);
  }

  async createReceipt(r: { receiptNo: string; studentId: number; amount: number; paymentDate: string; method: PaymentMethod; referenceNo?: string | null; receivedBy: number }, q: Queryable) {
    const { rows } = await q.query(
      `INSERT INTO receipts (receipt_no, student_id, amount, payment_date, method, reference_no, received_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [r.receiptNo, r.studentId, r.amount, r.paymentDate, r.method, r.referenceNo ?? null, r.receivedBy],
    );
    return rows[0].id as number;
  }

  async allocate(receiptId: number, invoiceId: number, amount: number, q: Queryable) {
    await q.query(`INSERT INTO payment_allocations (receipt_id, invoice_id, amount) VALUES ($1,$2,$3)`, [receiptId, invoiceId, amount]);
  }

  async getReceipt(id: number) {
    const { rows } = await this.db.query(
      `SELECT r.*, s.admission_no, concat_ws(' ', s.first_name, s.last_name) AS student_name,
              (SELECT COALESCE(json_agg(json_build_object('invoiceId', i.id, 'invoiceNo', i.invoice_no, 'amount', pa.amount,
                       'billingPeriod', i.billing_period)), '[]')
                 FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.receipt_id = r.id) AS allocations
         FROM receipts r JOIN students s ON s.id = r.student_id WHERE r.id = $1`,
      [id],
    );
    return rows[0] ? toCamel<Record<string, unknown> & { studentId: number }>(rows[0]) : null;
  }

  async getReceiptForUpdate(id: number, q: Queryable) {
    const { rows } = await q.query(`SELECT id, student_id, amount, status, receipt_no FROM receipts WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] ? toCamel<{ id: number; studentId: number; amount: number; status: string; receiptNo: string }>(rows[0]) : null;
  }

  async cancelReceipt(id: number, reason: string, q: Queryable) {
    await q.query(`UPDATE receipts SET status = 'cancelled', cancel_reason = $2 WHERE id = $1`, [id, reason]);
  }

  async studentExists(studentId: number) {
    return ((await this.db.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [studentId])).rowCount ?? 0) > 0;
  }

  async statement(studentId: number) {
    const { rows } = await this.db.query(
      `SELECT id, entry_date, entry_type, debit, credit, remarks, invoice_id, receipt_id,
              SUM(debit - credit) OVER (ORDER BY entry_date, id) AS running_balance
         FROM student_ledger WHERE student_id = $1
        ORDER BY entry_date, id`,
      [studentId],
    );
    const entries = rowsToCamel<Record<string, unknown> & { runningBalance: number }>(rows);
    return { entries, balance: entries.length ? Number(entries[entries.length - 1].runningBalance) : 0 };
  }
}
