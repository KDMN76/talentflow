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
import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

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
router.post('/', requirePermission('reports', 'write'), ctrl.createReport);

router.get('/:id', ctrl.getReport);
router.patch('/:id', requirePermission('reports', 'write'), ctrl.patchReport);
router.delete('/:id', requirePermission('reports', 'write'), ctrl.deleteReport);

router.post('/:id/duplicate', requirePermission('reports', 'write'), ctrl.duplicateReport);
// Uitvoeren van een bestaand rapport is een leesactie — geen write vereist.
router.post('/:id/run', requirePermission('reports', 'read'), ctrl.runReport);
router.get('/:id/runs', ctrl.listRuns);

// Embed aan/uit zet rapportdata publiek achter een token — admin-only.
router.post('/:id/embed', requireRole('admin', 'owner'), ctrl.enableEmbed);
router.delete('/:id/embed', requireRole('admin', 'owner'), ctrl.disableEmbed);

// ── Sprint Q3.5 (Agent GGG) — exporters + scheduling ────────────────────────
router.get('/:id/export/pdf', exportCtrl.exportReportPdfHandler);
router.get('/:id/export/excel', exportCtrl.exportReportExcelHandler);
router.get('/:id/export/csv', exportCtrl.exportReportCsvHandler);
router.post('/:id/schedule', requirePermission('reports', 'write'), exportCtrl.setReportScheduleHandler);
router.delete('/:id/schedule', requirePermission('reports', 'write'), exportCtrl.clearReportScheduleHandler);

export default router;
