/**
 * Invoicing HTTP routes — Sprint Q4.4 (Agent UUU).
 *
 * Mount path: `/api/invoices` (zie src/index.ts).
 *
 * Alle routes vereisen JWT (`requireAuth`) + tenant-context (`tenantMiddleware`).
 * Validatie via zod. Audit-events worden in de service-laag geschreven.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import { getStorage } from '../../lib/storage';
import * as service from './invoicing.service';
import * as accounting from '../accounting/accounting.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// ── GET / — list invoices ─────────────────────────────────────────────────
const listQuery = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).optional(),
  client_organization_id: z.string().uuid().optional(),
  contract_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listQuery.parse(req.query);
    const result = await service.listInvoices(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST / — generate invoice from contract ───────────────────────────────
const createBody = z.object({
  contract_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  aggregate: z.enum(['week', 'month', 'flat']).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createBody.parse(req.body);
    const result = await service.generateInvoiceFromContract(
      req.user!.tenantId,
      body.contract_id,
      body.period_start,
      body.period_end,
      {
        aggregate: body.aggregate,
        vat_rate: body.vat_rate,
        notes: body.notes,
        userId: req.user!.userId,
        auditCtx: auditCtxFromReq(req),
      }
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await service.getInvoice(
      req.user!.tenantId,
      req.params.id
    );
    if (!result) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', 'Factuur niet gevonden');
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /:id/issue ───────────────────────────────────────────────────────
router.post(
  '/:id/issue',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoice = await service.issueInvoice(
        req.user!.tenantId,
        req.params.id,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: invoice });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /:id/mark-paid ───────────────────────────────────────────────────
const markPaidBody = z.object({
  paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
router.post(
  '/:id/mark-paid',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = markPaidBody.parse(req.body);
      const invoice = await service.markPaid(
        req.user!.tenantId,
        req.params.id,
        body.paid_date,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: invoice });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /:id/void ────────────────────────────────────────────────────────
const voidBody = z.object({
  reason: z.string().min(2).max(500),
});
router.post(
  '/:id/void',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = voidBody.parse(req.body);
      const invoice = await service.voidInvoice(
        req.user!.tenantId,
        req.params.id,
        body.reason,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: invoice });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /:id/pdf — stream PDF ─────────────────────────────────────────────
router.get(
  '/:id/pdf',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getInvoice(
        req.user!.tenantId,
        req.params.id
      );
      if (!result) {
        throw new AppError(404, 'INVOICE_NOT_FOUND', 'Factuur niet gevonden');
      }
      let key = result.invoice.pdf_storage_key;
      if (!key) {
        // Lazy-render — bouwt PDF on the fly als deze nog niet bestaat.
        const pdf = await service.renderInvoicePdf(
          {
            invoice_number: result.invoice.invoice_number,
            status: result.invoice.status,
            issued_date: result.invoice.issued_date,
            due_date: result.invoice.due_date,
            period_start: result.invoice.period_start,
            period_end: result.invoice.period_end,
            client_organization_id: result.invoice.client_organization_id,
            contract_id: result.invoice.contract_id,
            subtotal_amount: result.invoice.subtotal_amount,
            vat_rate: result.invoice.vat_rate,
            vat_amount: result.invoice.vat_amount,
            total_amount: result.invoice.total_amount,
            currency: result.invoice.currency,
            notes: result.invoice.notes,
          },
          result.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unit_price: l.unit_price,
            line_total: l.line_total,
          }))
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${result.invoice.invoice_number}.pdf"`
        );
        res.send(pdf);
        return;
      }
      const stream = await getStorage().getStream(key);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.invoice.invoice_number}.pdf"`
      );
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /:id/sync-accounting ─────────────────────────────────────────────
router.post(
  '/:id/sync-accounting',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await accounting.syncInvoiceToAccounting(
        req.user!.tenantId,
        req.params.id,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
