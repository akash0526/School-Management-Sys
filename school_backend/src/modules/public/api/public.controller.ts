import type { Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../../../shared/errors.js';
import { idParam, toOffset } from '../../../shared/http/params.js';
import type { PublicScope } from '../business/public.ports.js';
import type { PublicService } from '../business/public.service.js';
import * as s from './public.schemas.js';

/** API LAYER — public website endpoints (machine-to-machine, API key auth). */
export class PublicController {
  constructor(private readonly service: PublicService) {}

  /** Validates the X-API-Key header and attaches req.apiClient. */
  authenticate: RequestHandler = async (req, _res, next) => {
    const key = req.header('x-api-key');
    req.apiClient = await this.service.authenticate(key, req.ip);
    next();
  };

  static requireScope =
    (scope: PublicScope): RequestHandler =>
    (req, _res, next) => {
      if (!req.apiClient) throw unauthorized('Missing or invalid API key');
      if (!req.apiClient.scopes.includes(scope)) throw forbidden(`API key lacks scope '${scope}'`);
      next();
    };

  /** Public content may be cached briefly by the website / CDN. */
  private cache = (res: Response, seconds: number) => res.setHeader('Cache-Control', `public, max-age=${seconds}`);

  school = async (_req: Request, res: Response) => {
    this.cache(res, 300);
    res.json(await this.service.school());
  };
  notices = async (req: Request, res: Response) => {
    const q = s.noticesQuery.parse(req.query);
    this.cache(res, 60);
    res.json({ ...(await this.service.notices({ updatedSince: q.updatedSince, ...toOffset(q) })), page: q.page, pageSize: q.pageSize });
  };
  notice = async (req: Request, res: Response) => {
    this.cache(res, 60);
    res.json(await this.service.notice(idParam.parse(req.params).id));
  };
  events = async (req: Request, res: Response) => {
    const q = s.eventsQuery.parse(req.query);
    this.cache(res, 60);
    res.json({ ...(await this.service.events_({ from: q.from, to: q.to, ...toOffset(q) })), page: q.page, pageSize: q.pageSize });
  };
  staff = async (_req: Request, res: Response) => {
    this.cache(res, 300);
    res.json({ items: await this.service.staff() });
  };
  classes = async (_req: Request, res: Response) => {
    this.cache(res, 300);
    res.json({ items: await this.service.classes() });
  };
  createInquiry = async (req: Request, res: Response) => {
    const result = await this.service.createInquiry(req.apiClient!, s.inquiryBody.parse(req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  };
  lookupResult = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await this.service.lookupResult(req.apiClient!, s.resultLookupBody.parse(req.body)));
  };
}
