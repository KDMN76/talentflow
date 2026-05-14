/**
 * CSV-export router — Sprint Q1.2.
 *
 * Mount-pad: `/api/exports`. Alle endpoints staan achter
 * `requireAuth + tenantMiddleware` zodat we tenant_id uit de JWT trekken
 * en RLS de query's afdwingt.
 *
 * Endpoint-naming volgt de bestaande conventie: één segment per entity.
 * Filters worden via query-string meegegeven (zelfde shape als de
 * list-endpoints). Voorbeeld:
 *
 *   GET /api/exports/candidates?source=linkedin&skills=react,typescript
 *   GET /api/exports/jobs?status=open
 *   GET /api/exports/applications?job_id=<uuid>
 *   GET /api/exports/communications?channel=email
 *   GET /api/exports/workflows
 */

import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import * as exportsController from './exports.controller';

const router = Router();

router.use(requireAuth, tenantMiddleware);

router.get('/candidates', exportsController.exportCandidatesHandler);
router.get('/jobs', exportsController.exportJobsHandler);
router.get('/applications', exportsController.exportApplicationsHandler);
router.get('/communications', exportsController.exportCommunicationsHandler);
router.get('/workflows', exportsController.exportWorkflowsHandler);

export default router;
