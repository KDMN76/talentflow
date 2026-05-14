/**
 * Reports router — mounted at /api/reports.
 *
 * Sprint Q3.5 (Agent EEE).
 *
 * Twee routers worden geëxporteerd zodat de embed-endpoint (geen auth) apart
 * gemount kan worden in index.ts vóór de auth-protected router. Dat voorkomt
 * dat requireAuth de embed-route blocked.
 */

import { Router } from 'express';
import * as ctrl from './reports.controller';
import * as exportCtrl from './reports.exports.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

// ── Public — geen auth, alleen /embed/:token/run + /embed/:token (Agent GGG)
export const reportsPublicRouter = Router();
reportsPublicRouter.get('/embed/:token/run', ctrl.runEmbed);
reportsPublicRouter.get('/embed/:token', exportCtrl.getReportEmbedHandler);

// ── Authenticated
const router = Router();
router.use(requireAuth, tenantMiddleware);

// Read-only constants — moeten VOOR /:id staan zodat ze niet als id worden gevangen.
router.get('/templates', ctrl.listTemplates);
router.get('/dimensions', ctrl.listDimensions);
router.get('/metrics', ctrl.listMetrics);

router.get('/', ctrl.listReports);
router.post('/', ctrl.createReport);

router.get('/:id', ctrl.getReport);
router.patch('/:id', ctrl.patchReport);
router.delete('/:id', ctrl.deleteReport);

router.post('/:id/duplicate', ctrl.duplicateReport);
router.post('/:id/run', ctrl.runReport);
router.get('/:id/runs', ctrl.listRuns);

router.post('/:id/embed', ctrl.enableEmbed);
router.delete('/:id/embed', ctrl.disableEmbed);

// ── Sprint Q3.5 (Agent GGG) — exporters + scheduling ────────────────────────
router.get('/:id/export/pdf', exportCtrl.exportReportPdfHandler);
router.get('/:id/export/excel', exportCtrl.exportReportExcelHandler);
router.get('/:id/export/csv', exportCtrl.exportReportCsvHandler);
router.post('/:id/schedule', exportCtrl.setReportScheduleHandler);
router.delete('/:id/schedule', exportCtrl.clearReportScheduleHandler);

export default router;
