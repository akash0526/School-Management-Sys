import type { AuthUser } from '../../../shared/auth/types.js';
import { hasPermission } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import { omit } from '../../../shared/db/sql.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors.js';
/** Staff statuses that mean the person no longer works here (on_leave keeps access). */
const STAFF_LEFT = ['resigned', 'retired', 'terminated'];

import type { StaffInput, StaffMember, StaffRepository, UserAccountService } from './staff.ports.js';

/** Fields only HR (staff.manage) or the staff member themself may see. */
const SENSITIVE_FIELDS = ['citizenshipNo', 'panNo', 'bankName', 'bankAccountNo', 'dob', 'address', 'customFields'] as const;

/** Roles a staff.manage user may give when creating a staff login (no privilege escalation). */
const STAFF_ASSIGNABLE_ROLES = ['teacher', 'accountant', 'librarian', 'admin_staff'];

/** BUSINESS LAYER — staff rules. */
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly tx: TransactionRunner,
    private readonly accounts: UserAccountService,
  ) {}

  async list(actor: AuthUser, f: Parameters<StaffRepository['list']>[0]) {
    const result = await this.repo.list(f);
    return { ...result, items: result.items.map((m) => this.redact(actor, m)) };
  }

  async get(actor: AuthUser, id: number) {
    const isSelf = actor.staffId === id;
    if (!isSelf && !hasPermission(actor, 'staff.view')) throw forbidden();
    const m = await this.repo.findById(id);
    if (!m) throw notFound('Staff member');
    return this.redact(actor, m);
  }

  async create(actor: AuthUser, input: StaffInput) {
    this.assertDates(input);
    return this.tx.transaction(actor.userId, (t) => this.repo.create(input, t));
  }

  async update(actor: AuthUser, id: number, input: Partial<StaffInput>) {
    this.assertDates(input);
    const m = await this.tx.transaction(actor.userId, async (t) => {
      const before = await this.repo.findById(id, t);
      if (!before) return null;
      const updated = await this.repo.update(id, input, t);
      // Someone who has left the school must not keep a working login.
      const leaving = input.status && STAFF_LEFT.includes(input.status) && !STAFF_LEFT.includes(String(before.status));
      if (leaving && before.userId) {
        await this.accounts.deactivateLinkedAccount(actor, before.userId as number, `staff status → ${input.status}`, t);
      }
      return updated;
    });
    if (!m) throw notFound('Staff member');
    return m;
  }

  async createAccount(actor: AuthUser, id: number, input: { username: string; password?: string; roles: string[] }) {
    const canAssignAnything = hasPermission(actor, 'users.manage');
    const disallowed = input.roles.filter((r) => !STAFF_ASSIGNABLE_ROLES.includes(r));
    if (!canAssignAnything && disallowed.length) {
      throw forbidden(`You can only assign these roles: ${STAFF_ASSIGNABLE_ROLES.join(', ')}`);
    }
    return this.tx.transaction(actor.userId, async (t) => {
      const m = await this.repo.findById(id, t);
      if (!m) throw notFound('Staff member');
      if (m.userId) throw conflict('This staff member already has a login');
      const account = await this.accounts.createAccount(
        actor,
        { ...input, phone: (m.phone as string) ?? null, email: (m.email as string) ?? null },
        t,
      );
      await this.repo.setUserId(id, account.userId, t);
      return account;
    });
  }

  listDepartments() {
    return this.repo.listDepartments();
  }

  createDepartment(actor: AuthUser, name: string) {
    return this.tx.transaction(actor.userId, (t) => this.repo.createDepartment(name, t));
  }

  private redact(actor: AuthUser, m: StaffMember) {
    const full = hasPermission(actor, 'staff.manage') || actor.staffId === m.id;
    return full ? m : omit(m, SENSITIVE_FIELDS as unknown as (keyof StaffMember)[]);
  }

  private assertDates(input: Partial<StaffInput>) {
    if (input.joinDate && input.leaveDate && input.leaveDate < input.joinDate) {
      throw badRequest('Leave date cannot be before join date');
    }
  }
}
