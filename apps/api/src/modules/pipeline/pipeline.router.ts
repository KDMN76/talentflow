import { Router } from 'express';
import * as pipelineController from './pipeline.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Stage management
router.get('/jobs/:jobId/stages', pipelineController.getStagesForJob);
router.post('/jobs/:jobId/stages', pipelineController.createStage);
router.patch('/stages/:stageId', pipelineController.updateStage);
router.delete('/stages/:stageId', pipelineController.deleteStage);

// Applications in pipeline
router.get('/jobs/:jobId/applications', pipelineController.getApplicationsForJob);
router.post('/applications', pipelineController.addToPipeline);
router.patch('/applications/:id', pipelineController.updateApplication);
router.delete('/applications/:id', pipelineController.removeApplication);

export default router;
