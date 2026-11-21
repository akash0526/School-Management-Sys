import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam } from '../../../shared/http/params.js';
import type { ExamsService } from '../business/exams.service.js';
import * as s from './exams.schemas.js';

/** API LAYER — exams endpoints. */
export class ExamsController {
  constructor(private readonly service: ExamsService) {}

  list = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listExams(s.listExamsQuery.parse(req.query).academicYearId) });
  };
  get = async (req: Request, res: Response) => {
    res.json(await this.service.getExam(idParam.parse(req.params).id));
  };
  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createExam(getAuth(req), s.examBody.parse(req.body)));
  };
  update = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.updateExam(getAuth(req), id, s.updateExamBody.parse(req.body)));
  };
  addSchedule = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await this.service.addSchedule(getAuth(req), id, s.scheduleBody.parse(req.body)));
  };
  listSchedules = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json({ items: await this.service.listSchedules(id, s.schedulesQuery.parse(req.query).classId) });
  };

  marksheet = async (req: Request, res: Response) => {
    const { componentId } = s.componentParam.parse(req.params);
    res.json(await this.service.marksheet(getAuth(req), componentId, s.sectionQuery.parse(req.query).sectionId));
  };
  enterMarks = async (req: Request, res: Response) => {
    const { componentId } = s.componentParam.parse(req.params);
    const body = s.marksBody.parse(req.body);
    res.json(
      await this.service.enterMarks(
        getAuth(req),
        componentId,
        body.sectionId,
        body.entries.map((e) => ({ ...e, marksObtained: e.marksObtained ?? null })),
      ),
    );
  };
  verify = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const body = s.verifyBody.parse(req.body);
    res.json(await this.service.verifyMarks(getAuth(req), id, body.sectionId, body.classSubjectId ?? null));
  };

  process = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const body = s.processBody.parse(req.body ?? {});
    res.json(await this.service.processResults(getAuth(req), id, { sectionId: body.sectionId ?? null, force: body.force }));
  };
  publish = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.setPublished(getAuth(req), id, s.publishBody.parse(req.body).published);
    res.status(204).end();
  };
  withhold = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.setWithheld(getAuth(req), id, s.withholdBody.parse(req.body)));
  };
  results = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json({ items: await this.service.listResults(id, s.resultsQuery.parse(req.query).sectionId) });
  };
  reportCard = async (req: Request, res: Response) => {
    const p = s.reportCardParams.parse(req.params);
    res.json(await this.service.reportCard(getAuth(req), p.id, p.studentId));
  };

  studentResults = async (req: Request, res: Response) => {
    const p = s.studentResultsParams.parse(req.params);
    res.json({ items: await this.service.studentResults(getAuth(req), p.studentId) });
  };
}
