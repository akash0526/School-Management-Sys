import type { AuthUser } from '../../../shared/auth/types.js';
import type { Tx } from '../../../shared/db/database.js';

export type Frequency = 'one_time' | 'monthly' | 'termly' | 'yearly';
export type PaymentMethod = 'cash' | 'bank_deposit' | 'cheque' | 'esewa' | 'khalti' | 'fonepay' | 'connectips' | 'other';

export interface BillableEnrollment {
  enrollmentId: number;
  studentId: number;
  classId: number;
  streamId: number | null;
}

export interface FeeStructureRow {
  classId: number;
  streamId: number | null;
  feeTypeId: number;
  feeTypeName: string;
  amount: number;
}

export interface DiscountRow {
  enrollmentId: number;
  feeTypeId: number | null;
  discountType: 'percent' | 'fixed';
  value: number;
}

export interface OpenInvoice {
  id: number;
  totalAmount: number;
  paidAmount: number;
}

export interface FeesRepository {
  listFeeTypes(): Promise<Record<string, unknown>[]>;
  createFeeType(f: { code: string; name: string; isRefundable?: boolean }, tx: Tx): Promise<Record<string, unknown>>;
  listStructures(academicYearId: number, classId?: number): Promise<Record<string, unknown>[]>;
  createStructure(s: { academicYearId: number; classId: number; streamId?: number | null; feeTypeId: number; amount: number; frequency: Frequency; dueDay?: number | null }, tx: Tx): Promise<Record<string, unknown>>;
  createDiscount(d: { enrollmentId: number; feeTypeId?: number | null; discountType: 'percent' | 'fixed'; value: number; reason: string; validFrom?: string | null; validTo?: string | null; approvedBy: number }, tx: Tx): Promise<Record<string, unknown>>;
  listDiscounts(enrollmentId: number): Promise<Record<string, unknown>[]>;

  getTextSetting(key: string): Promise<string | null>;
  getYearName(academicYearId: number): Promise<string | null>;
  billableEnrollments(f: { academicYearId: number; classId?: number; sectionId?: number }): Promise<BillableEnrollment[]>;
  structuresFor(academicYearId: number, frequencies: Frequency[], feeTypeIds?: number[]): Promise<FeeStructureRow[]>;
  discountsFor(enrollmentIds: number[], onDate: string): Promise<DiscountRow[]>;
  /** Live (non-cancelled) invoices for these enrollments in this period. Pass the transaction to re-check under the same snapshot. */
  enrollmentsAlreadyBilled(enrollmentIds: number[], billingPeriod: string, tx?: Tx): Promise<Set<number>>;
  nextInvoiceSeq(tx: Tx): Promise<number>;
  nextReceiptSeq(tx: Tx): Promise<number>;

  /**
   * Insert a WHOLE batch of invoices in a handful of statements instead of ~5 per student.
   *
   * `invoices` is the complete set to write; each one carries its own lines. Returns the
   * invoices that were actually created — an enrollment that another request billed for
   * the same period between our check and this insert is skipped by ON CONFLICT and comes
   * back absent, exactly as the per-student version returned null.
   *
   * The sequence is advanced once for the batch and invoice numbers are handed out from
   * that block, so a failed batch burns numbers (they are never reused) but can never
   * hand out a duplicate.
   */
  createInvoicesBatch(
    batch: {
      enrollmentId: number;
      studentId: number;
      items: Array<{ feeTypeId: number; description: string; amount: number; discount: number }>;
    }[],
    header: {
      billingPeriod: string;
      issueDate: string;
      dueDate: string | null;
      createdBy: number;
      /** Builds an invoice number from a sequence value; the repo advances the sequence once per batch. */
      invoiceNoFor: (seq: number) => string;
    },
    tx: Tx,
  ): Promise<{ id: number; enrollmentId: number; totalAmount: number }[]>;
  addLedgerEntry(
    e: { studentId: number; enrollmentId?: number | null; entryDate: string; entryType: 'charge' | 'payment' | 'adjustment' | 'refund' | 'fine' | 'discount' | 'opening_balance'; invoiceId?: number | null; receiptId?: number | null; debit?: number; credit?: number; remarks?: string | null; createdBy: number },
    tx: Tx,
  ): Promise<void>;

  /** Money dashboard: open dues, overdue dues and collections, computed in SQL. */
  summary(today: string): Promise<FeesSummary>;
  listInvoices(f: { studentId?: number; sectionId?: number; status?: string; billingPeriod?: string; limit: number; offset: number }): Promise<{ items: Record<string, unknown>[]; total: number }>;
  getInvoice(id: number): Promise<(Record<string, unknown> & { studentId: number }) | null>;
  getInvoiceForUpdate(id: number, tx: Tx): Promise<{ id: number; studentId: number; enrollmentId: number; status: string; totalAmount: number; paidAmount: number } | null>;
  cancelInvoice(id: number, reason: string, tx: Tx): Promise<void>;
  openInvoicesForStudent(studentId: number, tx: Tx): Promise<OpenInvoice[]>;

  createReceipt(r: { receiptNo: string; studentId: number; amount: number; paymentDate: string; method: PaymentMethod; referenceNo?: string | null; receivedBy: number }, tx: Tx): Promise<number>;
  allocate(receiptId: number, invoiceId: number, amount: number, tx: Tx): Promise<void>;
  getReceipt(id: number): Promise<(Record<string, unknown> & { studentId: number }) | null>;
  getReceiptForUpdate(id: number, tx: Tx): Promise<{ id: number; studentId: number; amount: number; status: string; receiptNo: string } | null>;
  cancelReceipt(id: number, reason: string, tx: Tx): Promise<void>;
  studentExists(studentId: number): Promise<boolean>;

  statement(studentId: number): Promise<{ entries: Record<string, unknown>[]; balance: number }>;
}

// ---------------- Ports to other modules ----------------
export interface StudentAccess {
  canViewStudent(user: AuthUser, studentId: number): Promise<boolean>;
  assertCanViewStudent(user: AuthUser, studentId: number): Promise<void>;
}

export interface FeesSummary {
  outstandingAmount: number;
  openInvoices: number;
  studentsWithDues: number;
  overdueAmount: number;
  overdueInvoices: number;
  collectedToday: number;
  receiptsToday: number;
  collectedLast30Days: number;
}
