import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as jobsController from './jobs.controller';
import * as jobDetailController from './jobDetail.controller';
import * as jdGeneratorController from './jdGenerator.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { enforcePayTransparency } from '../../middleware/payTransparency';

// ─────────────────────────────────────────────────────────────────────────────
// Multer config for job attachments (Slice 4.5)
// ─────────────────────────────────────────────────────────────────────────────
// Job attachments are tenant-scoped files associated with a single job. We
// reuse the same `uploads/` root used by candidate resumes — the storage
// abstraction (lib/storage) routes them to the correct tenant prefix.

const jobUploadsDir = path.join(process.cwd(), 'uploads', 'job-attachments');
if (!fs.existsSync(jobUploadsDir)) {
  fs.mkdirSync(jobUploadsDir, { recursive: true });
}

const jobAttachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, jobUploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const uploadJobAttachment = multer({
  storage: jobAttachmentStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per spec
  // Any mime is allowed — attachments cover JD docs, briefings, contract
  // drafts, etc. The storage-key sanitiser strips dangerous filename chars.
});

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

router.use(requireAuth, tenantMiddleware);

// ─── JD Generator (Sprint Q3.2) ─────────────────────────────────────────────
// Geplaatst BOVEN /:id-routes zodat /jd-drafts/... niet als :id wordt
// geïnterpreteerd. Express matcht specifieker eerst, maar we maken het
// expliciet voor grep-baarheid.
router.post('/jd-drafts', jdGeneratorController.createDraft);
router.get('/jd-drafts', jdGeneratorController.listDrafts);
router.get('/jd-drafts/:id', jdGeneratorController.getDraft);
router.post('/jd-drafts/:id/select-variant', jdGeneratorController.selectVariant);
router.post('/jd-drafts/:id/regenerate', jdGeneratorController.regenerateVariant);
router.post('/jd-drafts/:id/publish', jdGeneratorController.publishDraft);
router.delete('/jd-drafts/:id', jdGeneratorController.discardDraft);

// ─── List + create ──────────────────────────────────────────────────────────
router.get('/', jobsController.listJobs);
// Pay-transparency middleware (Sprint Q3.6) — blokkeert publish (status='open')
// zonder volledige salary-band conform EU Directive 2023/970. Alleen actief
// op publish-mutaties; drafts en andere status-changes passeren transparant.
router.post('/', enforcePayTransparency, jobsController.createJob);

// ─── Job-detail sub-resources (must come BEFORE /:id-only routes that
//     use bare `:id`. Because each of these has an additional path segment,
//     Express will dispatch them correctly even when listed after /:id —
//     but we keep them grouped first for clarity and grep-ability.) ──────────

// Team
router.get('/:id/team', jobDetailController.listJobTeam);
router.post('/:id/team', jobDetailController.addJobTeamMember);
router.delete('/:id/team/:userId', jobDetailController.removeJobTeamMember);

// Notes
router.get('/:id/notes', jobDetailController.listJobNotes);
router.post('/:id/notes', jobDetailController.createJobNote);
router.delete('/:id/notes/:noteId', jobDetailController.deleteJobNote);

// Attachments
router.get('/:id/attachments', jobDetailController.listJobAttachments);
router.post(
  '/:id/attachments',
  uploadJobAttachment.single('file'),
  jobDetailController.uploadJobAttachment
);
router.delete(
  '/:id/attachments/:attachmentId',
  jobDetailController.deleteJobAttachment
);
router.get(
  '/:id/attachments/:attachmentId/download',
  jobDetailController.downloadJobAttachment
);

// Health / funnel / comparable / sourcing / bias
router.get('/:id/health', jobDetailController.getJobHealth);
router.get('/:id/funnel', jobDetailController.getJobFunnel);
router.get('/:id/comparable', jobDetailController.getComparableJobs);
router.get('/:id/sourcing', jobDetailController.getJobSourcing);
router.get(
  '/:id/sourcing-suggestions',
  jobDetailController.getJobSourcingSuggestions
);
router.get('/:id/bias-check', jobDetailController.getJobBiasCheck);

// ─── Existing /:id routes ───────────────────────────────────────────────────
router.get('/:id', jobsController.getJob);
router.patch('/:id', enforcePayTransparency, jobsController.updateJob);
router.delete('/:id', jobsController.deleteJob);
router.post('/:id/duplicate', jobsController.duplicateJob);
router.get('/:id/stats', jobsController.getJobStats);
router.post('/:id/pipeline-template', jobsController.applyPipelineTemplate);

export default router;
