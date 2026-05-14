/**
 * Miscellaneous route-stubs voor lager-prioriteit modules.
 *
 * Deze entries zijn bewust beknopt — voldoende om te verschijnen in Swagger UI
 * als referentie. Per endpoint wordt later de zod-schema geïmporteerd uit het
 * controller-bestand om de spec te verfijnen (zie TODO-marker per endpoint).
 */

import { z } from 'zod';
import { registry } from '../registry';
import { authSecurity, idParam, jsonResponse } from '../common';

// ─── Tenants & Users ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/tenants/me',
  tags: ['Tenants'],
  summary: 'Get current tenant',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/tenants/me',
  tags: ['Tenants'],
  summary: 'Update tenant settings (branding, locale, …)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/users',
  tags: ['Users'],
  summary: 'List users in tenant',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/invite',
  tags: ['Users'],
  summary: 'Invite a user',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

// ─── Dashboard & Analytics ────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/dashboard',
  tags: ['Dashboard'],
  summary: 'Recruiter dashboard widgets',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/analytics/funnel',
  tags: ['Analytics'],
  summary: 'Pipeline funnel — tenant-wide',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/analytics/sourcing',
  tags: ['Analytics'],
  summary: 'Sourcing-effectiveness',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/analytics/time-to-hire',
  tags: ['Analytics'],
  summary: 'Time-to-hire metrics',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

// ─── Workflows ────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/workflows',
  tags: ['Workflows'],
  summary: 'List automation workflows',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/workflows',
  tags: ['Workflows'],
  summary: 'Create workflow',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/workflows/{id}',
  tags: ['Workflows'],
  summary: 'Update workflow',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'delete',
  path: '/api/workflows/{id}',
  tags: ['Workflows'],
  summary: 'Delete workflow',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Verwijderd' } },
});

// ─── CRM ──────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/crm/companies',
  tags: ['CRM'],
  summary: 'List companies',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/crm/companies',
  tags: ['CRM'],
  summary: 'Create company',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/crm/contacts',
  tags: ['CRM'],
  summary: 'List CRM contacts',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'get',
  path: '/api/crm/deals',
  tags: ['CRM'],
  summary: 'List deals (placements)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

// ─── Career pages & Portal ────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/career-pages/{slug}',
  tags: ['Career Pages', 'Public'],
  summary: 'Render public career page (JSON)',
  request: { params: z.object({ slug: z.string() }) },
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'post',
  path: '/api/career-pages/{slug}/applications',
  tags: ['Career Pages', 'Public'],
  summary: 'Submit application from career page',
  request: { params: z.object({ slug: z.string() }) },
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/portals/{slug}/jobs',
  tags: ['Portal'],
  summary: 'White-label client portal — list jobs',
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

// ─── Hiring Manager ───────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/hm/jobs',
  tags: ['Hiring Manager'],
  summary: 'Jobs assigned to current hiring-manager',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'get',
  path: '/api/hm/jobs/{id}/applications',
  tags: ['Hiring Manager'],
  summary: 'Applications for HM-review',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

// ─── Job boards: see ./job-boards.ts (Sprint Q4.3) ────────────────────────

// ─── Email templates ──────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/email-templates',
  tags: ['Email Templates'],
  summary: 'List email templates',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/email-templates',
  tags: ['Email Templates'],
  summary: 'Create email template',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

// ─── Integrations ─────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/integrations/mailbox',
  tags: ['Integrations'],
  summary: 'List mailbox integrations (Gmail/Outlook)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/integrations/mailbox/connect',
  tags: ['Integrations'],
  summary: 'Initiate OAuth flow',
  security: authSecurity,
  responses: {
    200: jsonResponse('OK', z.object({ oauth_url: z.string().url() })),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/integrations/mailbox/{id}',
  tags: ['Integrations'],
  summary: 'Disconnect mailbox',
  security: authSecurity,
  request: { params: idParam },
  responses: { 204: { description: 'Disconnected' } },
});

// ─── Saved searches & Custom fields ───────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/saved-searches',
  tags: ['Saved Searches'],
  summary: 'List saved searches',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/saved-searches',
  tags: ['Saved Searches'],
  summary: 'Save current search',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/custom-fields',
  tags: ['Custom Fields'],
  summary: 'List tenant custom fields',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/custom-fields',
  tags: ['Custom Fields'],
  summary: 'Create custom field',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

// ─── Scorecards ───────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/scorecards',
  tags: ['Scorecards'],
  summary: 'List scorecard templates',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.array(z.unknown())) },
});

registry.registerPath({
  method: 'post',
  path: '/api/applications/{id}/scorecards',
  tags: ['Scorecards'],
  summary: 'Submit scorecard for application',
  security: authSecurity,
  request: { params: idParam },
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/applications/{id}/agreement-matrix',
  tags: ['Scorecards'],
  summary: 'Inter-rater agreement matrix',
  security: authSecurity,
  request: { params: idParam },
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

// ─── Notifications ────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/notifications/subscribe',
  tags: ['Notifications'],
  summary: 'Register web-push subscription',
  security: authSecurity,
  responses: { 201: jsonResponse('Aangemaakt', z.unknown()) },
});

registry.registerPath({
  method: 'get',
  path: '/api/notifications/preferences',
  tags: ['Notifications'],
  summary: 'Get notification preferences',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'patch',
  path: '/api/notifications/preferences',
  tags: ['Notifications'],
  summary: 'Update notification preferences',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

// ─── Exports ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/api/exports/candidates',
  tags: ['Exports'],
  summary: 'Export candidates (CSV / Excel)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

registry.registerPath({
  method: 'post',
  path: '/api/exports/jobs',
  tags: ['Exports'],
  summary: 'Export jobs (CSV / Excel)',
  security: authSecurity,
  responses: { 200: jsonResponse('OK', z.unknown()) },
});

// ─── Health ───────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Public'],
  summary: 'Liveness probe',
  responses: {
    200: jsonResponse(
      'OK',
      z.object({ status: z.literal('ok'), timestamp: z.string().datetime() })
    ),
  },
});
