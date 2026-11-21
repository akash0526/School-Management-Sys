import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import { idParam, pageQuery, toOffset } from '../../../shared/http/params.js';
import type { FeesService } from '../business/fees.service.js';
import * as s from './fees.schemas.js';

/** API LAYER — fees endpoints. */
export class FeesController {
  constructor(private readonly service: FeesService) {}

  listFeeTypes = async (_req: Request, res: Response) => {
    res.json({ items: await this.service.listFeeTypes() });
  };
  createFeeType = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createFeeType(getAuth(req), s.feeTypeBody.parse(req.body)));
  };
  listStructures = async (req: Request, res: Response) => {
    const q = s.structuresQuery.parse(req.query);
    res.json({ items: await this.service.listStructures(q.academicYearId, q.classId) });
  };
  createStructure = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createStructure(getAuth(req), s.structureBody.parse(req.body)));
  };
  createDiscount = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.createDiscount(getAuth(req), s.discountBody.parse(req.body)));
  };
  listDiscounts = async (req: Request, res: Response) => {
    res.json({ items: await this.service.listDiscounts(s.discountsQuery.parse(req.query).enrollmentId) });
  };

  generateInvoices = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.generateInvoices(getAuth(req), s.generateBody.parse(req.body)));
  };
  summary = async (_req: Request, res: Response) => {
    res.json(await this.service.summary());
  };
  listInvoices = async (req: Request, res: Response) => {
    const q = s.invoicesQuery.parse(req.query);
    const { page, pageSize, ...filters } = q;
    res.json({ ...(await this.service.listInvoices({ ...filters, ...toOffset(q) })), page, pageSize });
  };
  getInvoice = async (req: Request, res: Response) => {
    res.json(await this.service.getInvoice(getAuth(req), idParam.parse(req.params).id));
  };
  cancelInvoice = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.cancelInvoice(getAuth(req), id, s.cancelBody.parse(req.body).reason);
    res.status(204).end();
  };

  collect = async (req: Request, res: Response) => {
    res.status(201).json(await this.service.collectPayment(getAuth(req), s.receiptBody.parse(req.body)));
  };
  getReceipt = async (req: Request, res: Response) => {
    res.json(await this.service.getReceipt(getAuth(req), idParam.parse(req.params).id));
  };
  cancelReceipt = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.cancelReceipt(getAuth(req), id, s.cancelBody.parse(req.body).reason);
    res.status(204).end();
  };

  statement = async (req: Request, res: Response) => {
    res.json(await this.service.statement(getAuth(req), s.studentParam.parse(req.params).studentId));
  };
  studentInvoices = async (req: Request, res: Response) => {
    const { studentId } = s.studentParam.parse(req.params);
    const q = pageQuery.parse(req.query);
    const { limit, offset } = toOffset(q);
    res.json({ ...(await this.service.studentInvoices(getAuth(req), studentId, limit, offset)), page: q.page, pageSize: q.pageSize });
  };
}
