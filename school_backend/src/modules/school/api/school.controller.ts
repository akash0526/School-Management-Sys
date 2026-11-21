import type { Request, Response } from 'express';
import { getAuth } from '../../../shared/auth/middleware.js';
import type { SchoolService } from '../business/school.service.js';
import * as s from './school.schemas.js';

/** API LAYER — school profile & branding. */
export class SchoolController {
  constructor(private readonly service: SchoolService) {}

  branding = async (_req: Request, res: Response) => {
    res.json(await this.service.branding());
  };
  logo = async (_req: Request, res: Response) => {
    const img = await this.service.logoImage();
    if (!img) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No logo uploaded' } });
      return;
    }
    // the URL carries ?v=<updated_at>, so it can be cached; nosniff (helmet) stops type confusion
    res.set('Cache-Control', 'public, max-age=86400').type(img.mime).send(img.bytes);
  };
  profile = async (_req: Request, res: Response) => {
    res.json(await this.service.profile());
  };
  saveProfile = async (req: Request, res: Response) => {
    res.json(await this.service.saveProfile(getAuth(req), s.profileBody.parse(req.body)));
  };
  setLogo = async (req: Request, res: Response) => {
    res.json(await this.service.setLogo(getAuth(req), s.logoBody.parse(req.body).dataUrl));
  };
  removeLogo = async (req: Request, res: Response) => {
    await this.service.removeLogo(getAuth(req));
    res.status(204).end();
  };
}
