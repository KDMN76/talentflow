/**
 * Interview-recordings + calendar-sync router — Sprint Q3.4 (Agent CCC).
 *
 * Mount-point: `/api/interviews` (NA `interviewsRouter` zodat de speciale
 * sub-routes `/recordings/...` niet als interview-id worden herkend).
 *
 * Routes (alle authenticated + tenant-isolated):
 *
 *   POST   /:id/recordings                      multipart 'audio' + body { consent_given }
 *   GET    /:id/recordings                      list per interview
 *   GET    /recordings/:recId                   single recording metadata
 *   GET    /recordings/:recId/transcript        transcript + AI-summary
 *   DELETE /recordings/:recId                   hard delete (storage + row)
 *
 *   POST   /:id/calendar-sync                   alle interviewers (idempotent)
 *   POST   /:id/calendar-events/:userId         single user
 *   DELETE /:id/calendar-events                 cancel-flow
 */

import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import * as ctrl from './recordings.controller';

// In-memory upload — file.buffer wordt direct doorgegeven aan storage abstractie
// (Local/MinIO/S3). Memory-storage werkt prima voor recordings tot ~200MB; de
// service-laag enforces de hard cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

export const interviewRecordingsRouter = Router();
interviewRecordingsRouter.use(requireAuth, tenantMiddleware);

// ── Recordings ─────────────────────────────────────────────────────────────
// SUB-routes vóór `/:id/...` zodat ze niet conflicteren met interview-id's.
interviewRecordingsRouter.get('/recordings/:recId/transcript', ctrl.getTranscriptHandler);
interviewRecordingsRouter.get('/recordings/:recId', ctrl.getRecordingHandler);
interviewRecordingsRouter.delete(
  '/recordings/:recId',
  requirePermission('interviews', 'write'),
  ctrl.deleteRecordingHandler
);

interviewRecordingsRouter.post(
  '/:id/recordings',
  requirePermission('interviews', 'write'),
  upload.single('audio'),
  ctrl.uploadRecordingHandler
);
interviewRecordingsRouter.get('/:id/recordings', ctrl.listRecordingsHandler);

// ── Calendar sync ──────────────────────────────────────────────────────────
interviewRecordingsRouter.post(
  '/:id/calendar-sync',
  requirePermission('interviews', 'write'),
  ctrl.syncCalendarHandler
);
interviewRecordingsRouter.post(
  '/:id/calendar-events/:userId',
  requirePermission('interviews', 'write'),
  ctrl.syncCalendarSingleUserHandler
);
interviewRecordingsRouter.delete(
  '/:id/calendar-events',
  requirePermission('interviews', 'write'),
  ctrl.deleteCalendarHandler
);

export default interviewRecordingsRouter;
