import type { AuthUser } from '../../../shared/auth/types.js';
import type { TransactionRunner } from '../../../shared/db/database.js';
import type { EventBus } from '../../../shared/events/eventBus.js';
import { badRequest, conflict, notFound } from '../../../shared/errors.js';
import type { StudentAccessPolicy } from './students.policy.js';
import type { GuardianInput, StudentInput, StudentsRepository, StudentStatus, UserAccountService } from './students.ports.js';

/** BUSINESS LAYER — rules for students & guardians. */
export class StudentsService {
  constructor(
    private readonly repo: StudentsRepository,
    private readonly tx: TransactionRunner,
    private readonly policy: StudentAccessPolicy,
    private readonly accounts: UserAccountService,
    private readonly events: EventBus,
  ) {}

  // --------------------------- students ---------------------------
  list(f: { search?: string; status?: string; limit: number; offset: number }) {
    return this.repo.list(f);
  }

  async get(actor: AuthUser, id: number) {
    await this.policy.assertCanViewStudent(actor, id);
    const s = await this.repo.findById(id);
    if (!s) throw notFound('Student');
    return s;
  }

  /** Students linked to the logged-in user: a parent's children, or the student themself. */
  async mine(actor: AuthUser) {
    if (actor.guardianId) return this.repo.listChildrenOfGuardian(actor.guardianId);
    if (actor.studentId) {
      const s = await this.repo.findById(actor.studentId);
      return s ? [s] : [];
    }
    return [];
  }

  async create(actor: AuthUser, input: StudentInput) {
    this.assertDob(input.dob, input.admissionDate);
    const student = await this.tx.transaction(actor.userId, (t) => this.repo.create(input, t));
    this.events.publish('student.created', { studentId: student.id, actorUserId: actor.userId });
    return student;
  }

  async update(actor: AuthUser, id: number, input: Partial<StudentInput>) {
    if (input.dob) this.assertDob(input.dob, input.admissionDate);
    const s = await this.tx.transaction(actor.userId, (t) => this.repo.update(id, input, t));
    if (!s) throw notFound('Student');
    return s;
  }

  async changeStatus(actor: AuthUser, id: number, input: { status: StudentStatus; date: string; reason?: string | null }) {
    await this.tx.transaction(actor.userId, async (t) => {
      const s = await this.repo.findById(id, t);
      if (!s) throw notFound('Student');
      if (s.status === input.status) throw badRequest(`Student is already ${input.status}`);
      const leaving = ['transferred', 'left', 'graduated', 'dropped'].includes(input.status);
      await this.repo.setStatus(id, input.status, leaving ? input.date : null, t);
      // A student who has left keeps no portal login (guardian logins stay: dues/statements may still matter).
      if (leaving && s.userId) await this.accounts.deactivateLinkedAccount(actor, s.userId, `student status → ${input.status}`, t);
      await this.repo.addStatusHistory(
        { studentId: id, oldStatus: s.status, newStatus: input.status, changedOn: input.date, reason: input.reason, changedBy: actor.userId },
        t,
      );
    });
  }

  /** Create a portal login for the student (role: student). */
  async createStudentAccount(actor: AuthUser, id: number, input: { username: string; password?: string }) {
    return this.tx.transaction(actor.userId, async (t) => {
      const s = await this.repo.findById(id, t);
      if (!s) throw notFound('Student');
      if (s.userId) throw conflict('This student already has a login');
      const account = await this.accounts.createAccount(actor, { ...input, roles: ['student'] }, t);
      await this.repo.setUserId(id, account.userId, t);
      return account;
    });
  }

  // --------------------------- guardians ---------------------------
  async guardiansOf(actor: AuthUser, studentId: number) {
    await this.policy.assertCanViewStudent(actor, studentId);
    return this.repo.listGuardiansOfStudent(studentId);
  }

  /** Link an existing guardian, or create a new one and link it, in one transaction. */
  async addGuardian(
    actor: AuthUser,
    studentId: number,
    input: { guardianId?: number; guardian?: GuardianInput; relation: string; isPrimary: boolean; canPickup: boolean },
  ) {
    if (!input.guardianId === !input.guardian) throw badRequest('Provide either guardianId or guardian details, not both');
    return this.tx.transaction(actor.userId, async (t) => {
      if (!(await this.repo.findById(studentId, t))) throw notFound('Student');
      const guardianId = input.guardianId ?? (await this.repo.createGuardian(input.guardian!, t)).id;
      if (input.guardianId && !(await this.repo.findGuardianById(input.guardianId, t))) throw notFound('Guardian');
      await this.repo.linkGuardian({ studentId, guardianId, relation: input.relation, isPrimary: input.isPrimary, canPickup: input.canPickup }, t);
      return { guardianId };
    });
  }

  async removeGuardian(actor: AuthUser, studentId: number, guardianId: number) {
    const ok = await this.tx.transaction(actor.userId, (t) => this.repo.unlinkGuardian(studentId, guardianId, t));
    if (!ok) throw notFound('Guardian link');
  }

  listGuardians(f: { search?: string; limit: number; offset: number }) {
    return this.repo.listGuardians(f);
  }

  async getGuardian(id: number) {
    const g = await this.repo.findGuardianById(id);
    if (!g) throw notFound('Guardian');
    return g;
  }

  createGuardian(actor: AuthUser, input: GuardianInput) {
    return this.tx.transaction(actor.userId, (t) => this.repo.createGuardian(input, t));
  }

  async updateGuardian(actor: AuthUser, id: number, input: Partial<GuardianInput>) {
    const g = await this.tx.transaction(actor.userId, (t) => this.repo.updateGuardian(id, input, t));
    if (!g) throw notFound('Guardian');
    return g;
  }

  /** Create a parent-portal login for a guardian (role: parent). */
  async createGuardianAccount(actor: AuthUser, id: number, input: { username: string; password?: string }) {
    return this.tx.transaction(actor.userId, async (t) => {
      const g = await this.repo.findGuardianById(id, t);
      if (!g) throw notFound('Guardian');
      if (g.userId) throw conflict('This guardian already has a login');
      const account = await this.accounts.createAccount(
        actor,
        { ...input, phone: (g.phone as string) ?? null, email: (g.email as string) ?? null, roles: ['parent'] },
        t,
      );
      await this.repo.setGuardianUserId(id, account.userId, t);
      return account;
    });
  }

  private assertDob(dob: string, admissionDate?: string) {
    if (new Date(dob) >= new Date(admissionDate ?? new Date().toISOString().slice(0, 10))) {
      throw badRequest('Date of birth must be before the admission date');
    }
  }
}
