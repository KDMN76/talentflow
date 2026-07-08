/**
 * Compliance router — Sprint Q2.3.
 *
 * Mount-pad: `/api/compliance` voor alle CRUD + audit-trail browser.
 * Iedere endpoint vereist `requireAuth + tenantMiddleware`. RLS doet
 * tenant-isolatie tijdens de query.
 *
 * Compliance-acties zijn admin-werk; voor de meeste wijzig-endpoints
 * dwingen we `requireRole('admin', 'owner')` af. Recruiters mogen
 * lezen (audit-trail browse), maar niet schrijven.
 */

import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import * as complianceController from './compliance.controller';

const router = Router();

router.use(requireAuth, tenantMiddleware);

// ─── Retention policies ─────────────────────────────────────────────────────
router.get(
  '/retention-policies',
  complianceController.listRetentionPoliciesHandler
);
router.post(
  '/retention-policies',
  requireRole('admin', 'owner'),
  complianceController.createRetentionPolicyHandler
);
router.patch(
  '/retention-policies/:id',
  requireRole('admin', 'owner'),
  complianceController.updateRetentionPolicyHandler
);
router.delete(
  '/retention-policies/:id',
  requireRole('admin', 'owner'),
  complianceController.deleteRetentionPolicyHandler
);

// ─── DSAR ───────────────────────────────────────────────────────────────────
router.get('/dsar-requests', complianceController.listDsarRequestsHandler);
router.post('/dsar-requests', complianceController.createDsarRequestHandler);
router.patch(
  '/dsar-requests/:id',
  requireRole('admin', 'owner'),
  complianceController.updateDsarRequestHandler
);
router.get(
  '/dsar-requests/:id/export',
  requireRole('admin', 'owner'),
  complianceController.exportDsarRequestHandler
);
// AVG art. 15 — kort-levende download-link (data_export_tokens, 046) die
// veilig aan de betrokkene kan worden doorgestuurd.
router.post(
  '/dsar-requests/:id/export-link',
  requireRole('admin', 'owner'),
  complianceController.createDsarExportLinkHandler
);

// ─── Audit & AI events ──────────────────────────────────────────────────────
// Q4.2: gated achter audit:read permission. Custom-rollen kunnen zo zonder
// admin-rol audit-trail inzien (bv "Compliance Officer"-rol).
router.get(
  '/audit-events',
  requirePermission('audit', 'read'),
  complianceController.listAuditEventsHandler
);
// Distinct action-waarden voor de filter-dropdown. Statisch pad — bewust
// vóór '/audit-events/entity/:type/:id' geregistreerd.
router.get(
  '/audit-events/actions',
  requirePermission('audit', 'read'),
  complianceController.listAuditActionsHandler
);
router.get(
  '/audit-events/entity/:type/:id',
  requirePermission('audit', 'read'),
  complianceController.getEntityAuditHistoryHandler
);
router.post(
  '/audit-events/export',
  requirePermission('audit', 'admin'),
  complianceController.exportAuditTrailHandler
);
router.get(
  '/ai-events',
  requirePermission('audit', 'read'),
  complianceController.listAiEventsHandler
);

// ─── Sprint Q3.6 — Pay Transparency Directive + DEI funnel + pay-equity ─────
// Settings: alle authenticated users mogen lezen (compliance dashboard);
// alleen admin/owner mogen schrijven.
router.get('/pay-settings', complianceController.getPaySettingsHandler);
router.patch(
  '/pay-settings',
  requireRole('admin', 'owner'),
  complianceController.updatePaySettingsHandler
);

// Pay-transparency rapport (EU 2023/970 art. 5): read-only aggregatie over
// open/draft vacatures — lezen mag elke authenticated user, net als
// pay-settings GET (het rapport bevat geen kandidaat- of persoonsdata).
router.get(
  '/pay-transparency-report',
  complianceController.getPayTransparencyReportHandler
);

// Pay-equity reports: schrijven (genereren) is admin-werk; lezen mag breder
// zodat HR-analytics dashboard recruiters samenvatting kunnen tonen.
router.post(
  '/pay-equity',
  requireRole('admin', 'owner'),
  complianceController.generatePayEquityHandler
);
router.get(
  '/pay-equity/snapshots',
  complianceController.listPayEquitySnapshotsHandler
);

// DEI funnel: zelfde model — admin schrijft, alle authed users lezen.
router.post(
  '/dei-funnel',
  requireRole('admin', 'owner'),
  complianceController.generateDeiFunnelHandler
);
router.get(
  '/dei-funnel/snapshots',
  complianceController.listDeiFunnelSnapshotsHandler
);

// ─── Sprint Q4.6 — EU AI Act human-oversight-gate ───────────────────────────
// Voorstellen lezen mag elke authenticated user (recruiters zien hun
// review-wachtrij); beslissen is recruiter-werk en hoger — viewers en
// hiring managers beslissen niet over afwijzingen.
router.get('/ai-proposals', complianceController.listAiProposalsHandler);
router.post(
  '/ai-proposals/:id/decision',
  requireRole('admin', 'owner', 'recruiter'),
  complianceController.decideAiProposalHandler
);

// Kandidaat-AI-samenvatting (art. 13): welke AI-categorieën zijn op deze
// kandidaat toegepast + datums. Alleen metadata — geen prompts/hashes.
router.get(
  '/candidates/:id/ai-summary',
  complianceController.getCandidateAiSummaryHandler
);

// Retentie-status van de AI-logging (ai_events ≥ 6 mnd, WORM-gegarandeerd).
router.get(
  '/ai-retention-status',
  complianceController.getAiRetentionStatusHandler
);

export default router;
