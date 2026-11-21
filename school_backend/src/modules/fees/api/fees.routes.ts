import { Router } from 'express';
import { type AuthGuards, requirePermission } from '../../../shared/auth/middleware.js';
import type { FeesController } from './fees.controller.js';

export function feesRouter(c: FeesController, guards: AuthGuards) {
  const r = Router();
  r.use(guards.requireAuth);
  const view = requirePermission('fees.view');
  const manage = requirePermission('fees.manage');

  r.get('/types', view, c.listFeeTypes);
  r.post('/types', manage, c.createFeeType);
  r.get('/structures', view, c.listStructures);
  r.post('/structures', manage, c.createStructure);
  r.get('/discounts', view, c.listDiscounts);
  r.post('/discounts', requirePermission('fees.discount'), c.createDiscount);

  r.post('/invoices/generate', manage, c.generateInvoices);
  r.get('/summary', view, c.summary);
  r.get('/invoices', view, c.listInvoices);
  r.get('/invoices/:id', c.getInvoice); // owner or fees.view — business layer
  r.post('/invoices/:id/cancel', manage, c.cancelInvoice);

  r.post('/receipts', requirePermission('fees.collect'), c.collect);
  r.get('/receipts/:id', c.getReceipt); // owner or fees.view — business layer
  r.post('/receipts/:id/cancel', requirePermission('fees.cancel_receipt'), c.cancelReceipt);

  // parent / student self-service (ownership checked in business layer)
  r.get('/students/:studentId/statement', c.statement);
  r.get('/students/:studentId/invoices', c.studentInvoices);
  return r;
}
