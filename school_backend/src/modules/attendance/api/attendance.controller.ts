import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import type { AttendanceService } from '../business/attendance.service.js';
import * as s from './attendance.schemas.js';

/** API LAYER — attendance endpoints. */
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  markSection = async (req: Request, res: Response) => {
    const { sectionId } = s.sectionParam.parse(req.params);
    res.json(await this.service.markSection(getAuth(req), sectionId, s.markSectionBody.parse(req.body)));
  };

  sectionRoster = async (req: Request, res: Response) => {
    const { sectionId } = s.sectionParam.parse(req.params);
    const q = s.rosterQuery.parse(req.query);
    res.json({ items: await this.service.sectionRoster(getAuth(req), sectionId, q.date, q.periodId ?? null) });
  };

  studentRecords = async (req: Request, res: Response) => {
    const { studentId } = s.studentParam.parse(req.params);
    const q = s.rangeQuery.parse(req.query);
    res.json({ items: await this.service.studentRecords(getAuth(req), studentId, q.from, q.to) });
  };

  studentSummary = async (req: Request, res: Response) => {
    const { studentId } = s.studentParam.parse(req.params);
    res.json({ items: await this.service.studentSummary(getAuth(req), studentId, s.summaryQuery.parse(req.query).academicYearId) });
  };

  markStaff = async (req: Request, res: Response) => {
    const body = s.markStaffBody.parse(req.body);
    res.json(await this.service.markStaff(getAuth(req), body.date, body.records));
  };

  listStaff = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listStaff(s.staffDateQuery.parse(req.query).date) });
  };
}
