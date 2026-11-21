import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam } from '../../../shared/http/params.js';
import type { EnrollmentService } from '../business/enrollment.service.js';
import * as s from './enrollment.schemas.js';

/** API LAYER — enrollment endpoints. */
export class EnrollmentController {
  constructor(private readonly service: EnrollmentService) {}

  list = async (req: Request, res: Response) => {
    res.json({ items: await this.service.list(s.listQuery.parse(req.query)) });
  };
  get = async (req: Request, res: Response) => {
    res.json(await this.service.get(idParam.parse(req.params).id));
  };
  enroll = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.enroll(getAuth(req), s.enrollBody.parse(req.body)));
  };
  update = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.update(getAuth(req), id, s.updateBody.parse(req.body)));
  };
  setSubjects = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json({ items: await this.service.setOptionalSubjects(getAuth(req), id, s.subjectsBody.parse(req.body).classSubjectIds) });
  };
  assignRollNumbers = async (req: Request, res: Response) => {
    res.json(await this.service.assignRollNumbers(getAuth(req), s.sectionParam.parse(req.params).sectionId));
  };
  promote = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.promote(getAuth(req), s.promoteBody.parse(req.body)));
  };
}
