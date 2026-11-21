import type { AuthUser } from '../../../shared/auth/types.js';
import { hasPermission } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import type { EventBus } from '../../../shared/events/eventBus.js';
import { round2 } from '../../../shared/money.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors.js';
import { todayInNepal } from '../../../shared/time.js';
import type { DiscountRow, FeeStructureRow, FeesRepository, Frequency, PaymentMethod, StudentAccess } from './fees.ports.js';



/**
 * Pure helper: split a student's discounts across the fee lines of ONE invoice.
 *
 * A discount is either tied to a fee type (applies to that line) or "all fee types" (`feeTypeId = null`):
 *  - percent discounts are proportional, so applying one per line is the same as applying it to the bill;
 *  - a FIXED "all fee types" amount is a discount on the BILL (a staff-child or sibling allowance),
 *    so it is applied ONCE and spread over the lines — never once per line, which would multiply it
 *    by the number of fee types on the invoice.
 *
 * A line's discount never exceeds its own amount; a bill-wide fixed discount larger than the bill
 * simply discounts it to zero (the excess is dropped rather than creating a negative line).
 */
export function discountsForInvoice(
  lines: ReadonlyArray<{ feeTypeId: number; amount: number }>,
  discounts: DiscountRow[],
): number[] {
  const perLine = lines.map((line) => {
    const total = discounts
      .filter((d) => d.feeTypeId === line.feeTypeId || (d.feeTypeId === null && d.discountType === 'percent'))
      .reduce((sum, d) => sum + (d.discountType === 'percent' ? (line.amount * d.value) / 100 : d.value), 0);
    return round2(Math.min(total, line.amount));
  });

  let remaining = round2(
    discounts
      .filter((d) => d.feeTypeId === null && d.discountType === 'fixed')
      .reduce((sum, d) => sum + d.value, 0),
  );
  for (let i = 0; i < lines.length && remaining > 0; i++) {
    const room = round2(lines[i].amount - perLine[i]);
    if (room <= 0) continue;
    const take = round2(Math.min(room, remaining));
    perLine[i] = round2(perLine[i] + take);
    remaining = round2(remaining - take);
  }
  return perLine;
}

/** Pure helper: pick fee lines for a class/stream — a stream-specific fee overrides the general one. */
export function feeLinesFor(classId: number, streamId: number | null, structures: FeeStructureRow[]): FeeStructureRow[] {
  const forClass = structures.filter((s) => s.classId === classId && (s.streamId === null || s.streamId === streamId));
  const byType = new Map<number, FeeStructureRow>();
  for (const s of forClass) {
    const existing = byType.get(s.feeTypeId);
    if (!existing || (existing.streamId === null && s.streamId !== null)) byType.set(s.feeTypeId, s);
  }
  return [...byType.values()];
}

/** Pure helper: spread a payment over open invoices, oldest first. */
export function allocateFifo(amount: number, invoices: Array<{ id: number; totalAmount: number; paidAmount: number }>) {
  let remaining = amount;
  const allocations: Array<{ invoiceId: number; amount: number }> = [];
  for (const inv of invoices) {
    if (remaining <= 0) break;
    const due = round2(inv.totalAmount - inv.paidAmount);
    if (due <= 0) continue;
    const pay = round2(Math.min(due, remaining));
    allocations.push({ invoiceId: inv.id, amount: pay });
    remaining = round2(remaining - pay);
  }
  return { allocations, advance: remaining };
}

/** BUSINESS LAYER — fees, invoices, receipts, ledger. */
export class FeesService {
  constructor(
    private readonly repo: FeesRepository,
    private readonly tx: TransactionRunner,
    private readonly studentAccess: StudentAccess,
    private readonly events: EventBus,
  ) {}

  // ---------------- setup ----------------
  listFeeTypes() {
    return this.repo.listFeeTypes();
  }
  createFeeType(actor: AuthUser, f: { code: string; name: string; isRefundable?: boolean }) {
    return this.tx.transaction(actor.userId, (t) => this.repo.createFeeType(f, t));
  }
  listStructures(academicYearId: number, classId?: number) {
    return this.repo.listStructures(academicYearId, classId);
  }
  createStructure(actor: AuthUser, s: Parameters<FeesRepository['createStructure']>[0]) {
    return this.tx.transaction(actor.userId, (t) => this.repo.createStructure(s, t));
  }
  createDiscount(actor: AuthUser, d: Omit<Parameters<FeesRepository['createDiscount']>[0], 'approvedBy'>) {
    if (d.validFrom && d.validTo && d.validTo < d.validFrom) throw badRequest('validTo is before validFrom');
    return this.tx.transaction(actor.userId, (t) => this.repo.createDiscount({ ...d, approvedBy: actor.userId }, t));
  }
  listDiscounts(enrollmentId: number) {
    return this.repo.listDiscounts(enrollmentId);
  }

  // ---------------- invoices ----------------
  /** Bill every studying student of a class/section for a period. Atomic: all or nothing. */
  async generateInvoices(
    actor: AuthUser,
    input: { academicYearId: number; classId?: number; sectionId?: number; billingPeriod: string; frequencies: Frequency[]; feeTypeIds?: number[]; issueDate: string; dueDate?: string | null },
  ) {
    if (input.dueDate && input.dueDate < input.issueDate) throw badRequest('Due date is before issue date');
    const yearName = await this.repo.getYearName(input.academicYearId);
    if (!yearName) throw notFound('Academic year');

    const enrollments = await this.repo.billableEnrollments(input);
    if (!enrollments.length) throw badRequest('No studying students match this selection');
    const structures = await this.repo.structuresFor(input.academicYearId, input.frequencies, input.feeTypeIds);
    const discounts = await this.repo.discountsFor(enrollments.map((e) => e.enrollmentId), input.issueDate);
    const prefix = (await this.repo.getTextSetting('invoice_prefix')) ?? 'INV-';
    const enrollmentIds = enrollments.map((e) => e.enrollmentId);

    return this.tx.transaction(actor.userId, async (t) => {
      const skipped = { alreadyBilled: 0, noFees: 0 };
      // Re-check INSIDE the transaction: a check taken on the pool beforehand is a stale snapshot, so
      // two requests could both see "not billed yet" and both insert. The unique index on
      // (enrollment_id, billing_period) plus ON CONFLICT in createInvoicesBatch closes the remaining
      // window (another transaction committing between this SELECT and our INSERT).
      const already = await this.repo.enrollmentsAlreadyBilled(enrollmentIds, input.billingPeriod, t);

      // Build every invoice in memory first, then write them in one batch. The work per student
      // (pick fee lines, spread discounts) is pure; only the writes needed to be per-student.
      const batch: Array<{ enrollmentId: number; studentId: number; items: Array<{ feeTypeId: number; description: string; amount: number; discount: number }> }> = [];
      for (const e of enrollments) {
        if (already.has(e.enrollmentId)) {
          skipped.alreadyBilled++;
          continue;
        }
        const lines = feeLinesFor(e.classId, e.streamId, structures);
        if (!lines.length) {
          skipped.noFees++;
          continue;
        }
        const myDiscounts = discounts.filter((d) => d.enrollmentId === e.enrollmentId);
        const lineDiscounts = discountsForInvoice(lines, myDiscounts);
        batch.push({
          enrollmentId: e.enrollmentId,
          studentId: e.studentId,
          items: lines.map((l, i) => ({
            feeTypeId: l.feeTypeId,
            description: `${l.feeTypeName} — ${input.billingPeriod}`,
            amount: l.amount,
            discount: lineDiscounts[i],
          })),
        });
      }
      if (!batch.length) return { created: 0, totalBilled: 0, skipped };

      const written = await this.repo.createInvoicesBatch(
        batch,
        {
          billingPeriod: input.billingPeriod,
          issueDate: input.issueDate,
          dueDate: input.dueDate ?? null,
          createdBy: actor.userId,
          invoiceNoFor: (seq) => `${prefix}${yearName}-${String(seq).padStart(6, '0')}`,
        },
        t,
      );
      // Enrollments that another request billed between our check and the insert come back absent
      // instead of raising: count them the same way the per-student path did.
      skipped.alreadyBilled += batch.length - written.length;
      const totalBilled = written.reduce((sum, inv) => round2(sum + inv.totalAmount), 0);
      return { created: written.length, totalBilled, skipped };
    });
  }

  summary() {
    return this.repo.summary(todayInNepal());
  }

  listInvoices(f: Parameters<FeesRepository['listInvoices']>[0]) {
    return this.repo.listInvoices(f);
  }

  async getInvoice(actor: AuthUser, id: number) {
    const inv = await this.repo.getInvoice(id);
    if (!inv) throw notFound('Invoice');
    if (!hasPermission(actor, 'fees.view')) await this.studentAccess.assertCanViewStudent(actor, inv.studentId);
    return inv;
  }

  async cancelInvoice(actor: AuthUser, id: number, reason: string) {
    await this.tx.transaction(actor.userId, async (t) => {
      const inv = await this.repo.getInvoiceForUpdate(id, t);
      if (!inv) throw notFound('Invoice');
      if (inv.status === 'cancelled') throw conflict('Invoice is already cancelled');
      if (inv.paidAmount > 0) throw conflict('Invoice has payments — cancel those receipts first');
      await this.repo.cancelInvoice(id, reason, t);
      if (inv.totalAmount > 0) {
        await this.repo.addLedgerEntry(
          { studentId: inv.studentId, enrollmentId: inv.enrollmentId, entryDate: todayInNepal(), entryType: 'adjustment', invoiceId: id, credit: inv.totalAmount, remarks: `Invoice cancelled: ${reason}`, createdBy: actor.userId },
          t,
        );
      }
    });
  }

  // ---------------- receipts ----------------
  /**
   * Collect a payment. With explicit allocations the money goes to those invoices;
   * otherwise it is spread over open invoices oldest-first. Any remainder stays as advance credit.
   */
  async collectPayment(
    actor: AuthUser,
    input: { studentId: number; amount: number; method: PaymentMethod; referenceNo?: string | null; paymentDate?: string; allocations?: Array<{ invoiceId: number; amount: number }> },
  ) {
    if (!(await this.repo.studentExists(input.studentId))) throw notFound('Student');
    if (['cheque', 'bank_deposit', 'esewa', 'khalti', 'fonepay', 'connectips'].includes(input.method) && !input.referenceNo) {
      throw badRequest(`A reference number is required for ${input.method} payments`);
    }
    const paymentDate = input.paymentDate ?? todayInNepal();
    if (paymentDate > todayInNepal()) throw badRequest('Payment date cannot be in the future');
    const prefix = (await this.repo.getTextSetting('receipt_prefix')) ?? 'RCPT-';

    const result = await this.tx.transaction(actor.userId, async (t) => {
      let allocations: Array<{ invoiceId: number; amount: number }>;
      let advance: number;
      if (input.allocations?.length) {
        // business rule regardless of caller (the API schema checks this too)
        if (new Set(input.allocations.map((a) => a.invoiceId)).size !== input.allocations.length) {
          throw badRequest('Each invoice may appear only once in allocations');
        }
        const sum = round2(input.allocations.reduce((s, a) => s + a.amount, 0));
        if (sum > input.amount) throw badRequest('Allocations add up to more than the amount received');
        allocations = input.allocations;
        advance = round2(input.amount - sum);
      } else {
        ({ allocations, advance } = allocateFifo(input.amount, await this.repo.openInvoicesForStudent(input.studentId, t)));
      }

      const seq = await this.repo.nextReceiptSeq(t);
      const receiptNo = `${prefix}${String(seq).padStart(6, '0')}`;
      const receiptId = await this.repo.createReceipt(
        { receiptNo, studentId: input.studentId, amount: input.amount, paymentDate, method: input.method, referenceNo: input.referenceNo, receivedBy: actor.userId },
        t,
      );
      // DB triggers verify: same student, invoice open, not over-allocated, not overpaid
      for (const a of allocations) await this.repo.allocate(receiptId, a.invoiceId, a.amount, t);
      await this.repo.addLedgerEntry(
        { studentId: input.studentId, entryDate: paymentDate, entryType: 'payment', receiptId, credit: input.amount, remarks: `Receipt ${receiptNo} (${input.method})`, createdBy: actor.userId },
        t,
      );
      return { receiptId, receiptNo, allocations, advance };
    });
    this.events.publish('receipt.created', { receiptId: result.receiptId, studentId: input.studentId, amount: input.amount, actorUserId: actor.userId });
    return result;
  }

  async getReceipt(actor: AuthUser, id: number) {
    const r = await this.repo.getReceipt(id);
    if (!r) throw notFound('Receipt');
    if (!hasPermission(actor, 'fees.view')) await this.studentAccess.assertCanViewStudent(actor, r.studentId);
    return r;
  }

  async cancelReceipt(actor: AuthUser, id: number, reason: string) {
    const r = await this.tx.transaction(actor.userId, async (t) => {
      const receipt = await this.repo.getReceiptForUpdate(id, t);
      if (!receipt) throw notFound('Receipt');
      if (receipt.status === 'cancelled') throw conflict('Receipt is already cancelled');
      await this.repo.cancelReceipt(id, reason, t); // trigger removes it from invoices' paid amounts
      await this.repo.addLedgerEntry(
        { studentId: receipt.studentId, entryDate: todayInNepal(), entryType: 'adjustment', receiptId: id, debit: receipt.amount, remarks: `Receipt ${receipt.receiptNo} cancelled: ${reason}`, createdBy: actor.userId },
        t,
      );
      return receipt;
    });
    this.events.publish('receipt.cancelled', { receiptId: id, studentId: r.studentId, actorUserId: actor.userId });
  }

  // ---------------- student view ----------------
  async statement(actor: AuthUser, studentId: number) {
    if (!hasPermission(actor, 'fees.view')) await this.studentAccess.assertCanViewStudent(actor, studentId);
    if (!(await this.repo.studentExists(studentId))) throw notFound('Student');
    return this.repo.statement(studentId);
  }

  async studentInvoices(actor: AuthUser, studentId: number, limit: number, offset: number) {
    if (!hasPermission(actor, 'fees.view')) {
      if (!(await this.studentAccess.canViewStudent(actor, studentId))) throw forbidden('You cannot access this student');
    }
    return this.repo.listInvoices({ studentId, limit, offset });
  }
}
