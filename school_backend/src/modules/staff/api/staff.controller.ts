import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam, toOffset } from '../../../shared/http/params.js';
import type { StaffService } from '../business/staff.service.js';
import * as s from './staff.schemas.js';

/** API LAYER — staff endpoints. */
export class StaffController {
  constructor(private readonly service: StaffService) {}

  list = async (req: Request, res: Response) => {
    const q = s.listStaffQuery.parse(req.query);
    const { page, pageSize, ...filters } = q;
    const result = await this.service.list(getAuth(req), { ...filters, ...toOffset(q) });
    res.json({ ...result, page, pageSize });
  };

  me = async (req: Request, res: Response) => {
    const auth = getAuth(req);
    if (!auth.staffId) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No staff profile linked to this account' } });
      return;
    }
    res.json(await this.service.get(auth, auth.staffId));
  };

  get = async (req: Request, res: Response) => {
    res.json(await this.service.get(getAuth(req), idParam.parse(req.params).id));
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.create(getAuth(req), s.staffBody.parse(req.body)));
  };

  update = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json(await this.service.update(getAuth(req), id, s.updateStaffBody.parse(req.body)));
  };

  createAccount = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.status(201).json(await this.service.createAccount(getAuth(req), id, s.staffAccountBody.parse(req.body)));
  };

  listDepartments = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listDepartments() });
  };

  createDepartment = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createDepartment(getAuth(req), s.departmentBody.parse(req.body).name));
  };
}
