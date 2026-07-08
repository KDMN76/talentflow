import { Router } from 'express';
import * as pipelineController from './pipeline.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Mutaties vereisen write-permissies — read-only rollen (viewer) konden hier
// eerst zonder check stages/applications wijzigen (viewer-gap gedicht).
// Stages horen bij de vacature-inrichting → jobs:write; application-moves
// → applications:write (recruiter én hiring_manager behouden toegang).

// Stage management
router.get('/jobs/:jobId/stages', pipelineController.getStagesForJob);
router.post('/jobs/:jobId/stages', requirePermission('jobs', 'write'), pipelineController.createStage);
router.patch('/stages/:stageId', requirePermission('jobs', 'write'), pipelineController.updateStage);
router.delete('/stages/:stageId', requirePermission('jobs', 'write'), pipelineController.deleteStage);

// Applications in pipeline
router.get('/jobs/:jobId/applications', pipelineController.getApplicationsForJob);
router.post('/applications', requirePermission('applications', 'write'), pipelineController.addToPipeline);
router.patch('/applications/:id', requirePermission('applications', 'write'), pipelineController.updateApplication);
router.delete('/applications/:id', requirePermission('applications', 'write'), pipelineController.removeApplication);

export default router;
