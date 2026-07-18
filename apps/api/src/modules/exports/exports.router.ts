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
import { requirePermission } from '../../middleware/permissions';
import * as exportsController from './exports.controller';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// RBAC: bulk-export dumpt ruwe PII (kandidaten, contactgegevens, berichten)
// als CSV — dat is een ander risiconiveau dan de gepagineerde list-endpoints
// en mag niet aan read-only rollen (`viewer`) staan, ook al heeft viewer wél
// algemene `read` op deze resources. `write` sluit viewer uit (viewer heeft
// nergens write:true — zie readOnlyMatrix in lib/permissions.ts) en dekt
// verder exact de rollen die de onderliggende resource al mogen muteren.
router.get('/candidates', requirePermission('candidates', 'write'), exportsController.exportCandidatesHandler);
router.get('/jobs', requirePermission('jobs', 'write'), exportsController.exportJobsHandler);
router.get('/applications', requirePermission('applications', 'write'), exportsController.exportApplicationsHandler);
router.get('/communications', requirePermission('communications', 'write'), exportsController.exportCommunicationsHandler);
router.get('/workflows', requirePermission('workflows', 'write'), exportsController.exportWorkflowsHandler);

export default router;
