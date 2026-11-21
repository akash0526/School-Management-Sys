import { Router } from 'express';
import { limiter } from '../../../shared/http/middleware.js';
import { PublicController } from './public.controller.js';

/**
 * /api/v1/public/* — called by the WEBSITE SERVER (not browsers) with an X-API-Key header.
 * Every route needs a valid key AND the matching scope.
 */
export function publicRouter(c: PublicController) {
  const r = Router();
  const scope = PublicController.requireScope;
  const perClient = (req: any) => String(req.apiClient?.id ?? req.ip);

  r.use(limiter({ windowMinutes: 1, max: 120, keyPrefix: 'public-ip' })); // before auth: limits key guessing
  r.use(c.authenticate);
  r.use(limiter({ windowMinutes: 1, max: 600, keyPrefix: 'public-client', key: perClient }));

  r.get('/school', scope('school.read'), c.school);
  r.get('/classes', scope('inquiries.create'), c.classes); // for the inquiry form's class dropdown
  r.get('/notices', scope('notices.read'), c.notices);
  r.get('/notices/:id', scope('notices.read'), c.notice);
  r.get('/events', scope('events.read'), c.events);
  r.get('/staff', scope('staff.read'), c.staff);
  r.post('/inquiries', scope('inquiries.create'), limiter({ windowMinutes: 10, max: 100, keyPrefix: 'public-inq', key: perClient }), c.createInquiry);
  // POST keeps DOB out of URLs, proxy logs and browser history
  r.post('/results/lookup', scope('results.lookup'), limiter({ windowMinutes: 1, max: 60, keyPrefix: 'public-res', key: perClient }), c.lookupResult);
  return r;
}
