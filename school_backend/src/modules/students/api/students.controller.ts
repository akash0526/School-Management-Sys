import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam, toOffset } from '../../../shared/http/params.js';
import type { StudentsService } from '../business/students.service.js';
import * as s from './students.schemas.js';

/** API LAYER — students & guardians endpoints. */
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  list = async (req: Request, res: Response) => {
    const q = s.listStudentsQuery.parse(req.query);
    const result = await this.service.list({ search: q.search, status: q.status, ...toOffset(q) });
    res.json({ ...result, page: q.page, pageSize: q.pageSize });
  };

  mine = async (req: Request, res: Response) => {
    res.json({ items: await this.service.mine(getAuth(req)) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.get(getAuth(req), id));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.create(getAuth(req), s.studentBody.parse(req.body)));
  };

  update = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.update(getAuth(req), id, s.updateStudentBody.parse(req.body)));
  };

  changeStatus = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.changeStatus(getAuth(req), id, s.statusBody.parse(req.body));
    res.status(204).end();
  };

  createAccount = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await this.service.createStudentAccount(getAuth(req), id, s.accountBody.parse(req.body)));
  };

  guardiansOf = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json({ items: await this.service.guardiansOf(getAuth(req), id) });
  };

  addGuardian = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await this.service.addGuardian(getAuth(req), id, s.addGuardianBody.parse(req.body)));
  };

  removeGuardian = async (req: Request, res: Response) => {
    const p = s.studentGuardianParams.parse(req.params);
    await this.service.removeGuardian(getAuth(req), p.id, p.guardianId);
    res.status(204).end();
  };
}

export class GuardiansController {
  constructor(private readonly service: StudentsService) {}

  list = async (req: Request, res: Response) => {
    const q = s.listGuardiansQuery.parse(req.query);
    const result = await this.service.listGuardians({ search: q.search, ...toOffset(q) });
    res.json({ ...result, page: q.page, pageSize: q.pageSize });
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.service.getGuardian(idParam.parse(req.params).id));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createGuardian(getAuth(req), s.guardianBody.parse(req.body)));
  };

  update = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.updateGuardian(getAuth(req), id, s.updateGuardianBody.parse(req.body)));
  };

  createAccount = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await this.service.createGuardianAccount(getAuth(req), id, s.accountBody.parse(req.body)));
  };
}
