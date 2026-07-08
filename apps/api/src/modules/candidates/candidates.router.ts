import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as candidatesController from './candidates.controller';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads', 'resumes');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const ALLOWED_RESUME_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const resumeFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (ALLOWED_RESUME_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Alleen PDF en Word-bestanden zijn toegestaan'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: resumeFileFilter,
});

// Multi-upload — same disk storage, same per-file 10MB limit, max 5 files at once.
const uploadMulti = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: resumeFileFilter,
});

const router = Router();

router.use(requireAuth, tenantMiddleware);

// Pipeline templates — must come BEFORE /:id routes so 'pipeline-templates'
// isn't captured as a candidate id.
router.get('/pipeline-templates', candidatesController.listPipelineTemplates);

// Bulk actions (Q1.2) — MUST come BEFORE /:id routes om collisie met
// `:id = "bulk-actions"` te voorkomen.
// Mutaties vereisen `candidates:write` — read-only rollen (viewer) konden
// hier eerst zonder check schrijven/verwijderen (viewer-gap gedicht).
// Bewust 'write' (niet 'delete') op DELETE zodat recruiter-gedrag intact blijft.
router.post('/bulk-actions', requirePermission('candidates', 'write'), candidatesController.bulkActionsHandler);

// Candidates CRUD
router.get('/', candidatesController.listCandidates);
router.post('/', requirePermission('candidates', 'write'), candidatesController.createCandidate);
router.get('/:id', candidatesController.getCandidate);
router.patch('/:id', requirePermission('candidates', 'write'), candidatesController.updateCandidate);
router.delete('/:id', requirePermission('candidates', 'write'), candidatesController.deleteCandidate);

// Resume (legacy single-file path)
router.post('/:id/resume', requirePermission('candidates', 'write'), upload.single('resume'), candidatesController.uploadResume);

// Skills
router.get('/:id/skills', candidatesController.listCandidateSkills);
router.post('/:id/skills', requirePermission('candidates', 'write'), candidatesController.addCandidateSkill);
router.delete('/:id/skills/:skillId', requirePermission('candidates', 'write'), candidatesController.deleteCandidateSkill);

// Resumes — multi-CV per kandidaat. Specific routes BEFORE :id-only routes
// to avoid conflicts with `/candidates/:id` patterns.
router.get('/:id/resumes', candidatesController.listCandidateResumes);
router.post(
  '/:id/resumes',
  requirePermission('candidates', 'write'),
  uploadMulti.array('files', 5),
  candidatesController.uploadCandidateResumes
);
router.delete(
  '/:id/resumes/:resumeId',
  requirePermission('candidates', 'write'),
  candidatesController.deleteCandidateResume
);
router.patch(
  '/:id/resumes/:resumeId/primary',
  requirePermission('candidates', 'write'),
  candidatesController.setPrimaryResume
);
router.get(
  '/:id/resumes/:resumeId/download',
  candidatesController.downloadResume
);

// Activity timeline
router.get('/:id/timeline', candidatesController.getCandidateTimeline);

// Duplicate detection (email/phone/name+company match)
router.get('/:id/duplicates', candidatesController.getCandidateDuplicates);

export default router;
