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
  enrollmentsAlreadyBilled(enrollmentIds: number[], billingPeriod: string): Promise<Set<number>>;
  nextInvoiceSeq(tx: Tx): Promise<number>;
  nextReceiptSeq(tx: Tx): Promise<number>;

  createInvoice(
    inv: { invoiceNo: string; enrollmentId: number; billingPeriod: string; issueDate: string; dueDate: string | null; createdBy: number },
    items: Array<{ feeTypeId: number; description: string; amount: number; discount: number }>,
    tx: Tx,
  ): Promise<{ id: number; totalAmount: number }>;
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
