import type { AuthUser } from '../../../shared/auth/types.js';
import { hasPermission } from '../../../shared/auth/types.js';
import { forbidden } from '../../../shared/errors.js';
import type { StudentsRepository } from './students.ports.js';

/**
 * Ownership rules for student data (prevents IDOR — "change the id in the URL" attacks):
 *  - staff with students.view  -> any student
 *  - a student                 -> only themself
 *  - a guardian                -> only their own children
 *
 * Exposed to other modules (attendance, exams, fees) as the `StudentAccess` port.
 */
export class StudentAccessPolicy {
  constructor(private readonly repo: StudentsRepository) {}

  async canViewStudent(user: AuthUser, studentId: number): Promise<boolean> {
    if (hasPermission(user, 'students.view')) return true;
    if (user.studentId !== null && user.studentId === studentId) return true;
    if (user.guardianId !== null) return this.repo.isGuardianOf(user.guardianId, studentId);
    return false;
  }

  async assertCanViewStudent(user: AuthUser, studentId: number): Promise<void> {
    if (!(await this.canViewStudent(user, studentId))) throw forbidden('You cannot access this student');
  }
}
