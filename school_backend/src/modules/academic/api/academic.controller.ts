import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam } from '../../../shared/http/params.js';
import type { AcademicService } from '../business/academic.service.js';
import * as s from './academic.schemas.js';

/** API LAYER — academic structure endpoints. */
export class AcademicController {
  constructor(private readonly service: AcademicService) {}

  listYears = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listYears() });
  };
  createYear = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createYear(getAuth(req), s.yearBody.parse(req.body)));
  };
  setCurrentYear = async (req: Request, res: Response) => {
    await this.service.setCurrentYear(getAuth(req), idParam.parse(req.params).id);
    res.status(204).end();
  };
  listTerms = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listTerms(idParam.parse(req.params).id) });
  };
  createTerm = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await this.service.createTerm(getAuth(req), { ...s.termBody.parse(req.body), academicYearId: id }));
  };

  listClasses = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listClasses() });
  };
  listStreams = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listStreams() });
  };
  listRooms = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listRooms() });
  };

  listSections = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listSections(s.sectionsQuery.parse(req.query)) });
  };
  createSection = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createSection(getAuth(req), s.sectionBody.parse(req.body)));
  };
  updateSection = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.updateSection(getAuth(req), id, s.updateSectionBody.parse(req.body)));
  };

  listSubjects = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listSubjects() });
  };
  createSubject = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createSubject(getAuth(req), s.subjectBody.parse(req.body)));
  };

  listClassSubjects = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listClassSubjects(s.classSubjectsQuery.parse(req.query)) });
  };
  createClassSubject = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createClassSubject(getAuth(req), s.classSubjectBody.parse(req.body)));
  };

  listAssignments = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listTeacherAssignments(s.assignmentsQuery.parse(req.query)) });
  };
  createAssignment = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createTeacherAssignment(getAuth(req), s.assignmentBody.parse(req.body)));
  };
  deleteAssignment = async (req: Request, res: Response) => {
    await this.service.deleteTeacherAssignment(getAuth(req), idParam.parse(req.params).id);
    res.status(204).end();
  };

  listCalendar = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listCalendar(s.calendarQuery.parse(req.query).academicYearId) });
  };
  createCalendarEntry = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createCalendarEntry(getAuth(req), s.calendarBody.parse(req.body)));
  };
}
