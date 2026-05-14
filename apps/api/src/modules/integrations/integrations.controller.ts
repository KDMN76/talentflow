/**
 * Integrations controller — REST handlers voor mailbox OAuth-flows.
 *
 * Routes (gemount op `/api/integrations`):
 *   GET    /mailbox                                 — list per tenant/user
 *   GET    /mailbox/oauth/:provider/start           — kickoff (JSON of 302)
 *   GET    /mailbox/oauth/callback?code&state       — provider callback (publiek)
 *   DELETE /mailbox/:id                             — soft disconnect
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as mailboxService from './mailbox.service';
import { AppError, logger } from '../../middleware/errorHandler';

// ─── Schemas ────────────────────────────────────────────────────────────────

const providerSchema = z.enum(['gmail', 'outlook']);

const startQuerySchema = z.object({
  format: z.enum(['json', 'redirect']).optional(),
});

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWebBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? 'http://localhost:3000';
}

function buildSettingsRedirect(status: 'success' | 'error', reason?: string): string {
  const base = `${getWebBaseUrl()}/settings/integrations`;
  const params = new URLSearchParams({ status });
  if (reason) params.set('reason', reason);
  return `${base}?${params.toString()}`;
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export async function listMailboxIntegrationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const onlyMine = req.query.scope === 'mine';
    const records = await mailboxService.listIntegrations(
      req.user!.tenantId,
      onlyMine ? req.user!.userId : undefined
    );
    res.json({ data: records });
  } catch (err) {
    next(err);
  }
}

export async function startOAuthHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const provider = providerSchema.parse(req.params.provider);
    const query = startQuerySchema.parse(req.query);

    const { url, state } = await mailboxService.startOAuth(
      req.user!.tenantId,
      req.user!.userId,
      provider
    );

    // Browser callers expect a 302 redirect (top-level navigation). XHR
    // callers explicitly request JSON via `?format=json` or Accept-header.
    const wantsJson =
      query.format === 'json' || req.accepts(['html', 'json']) === 'json';
    if (wantsJson) {
      res.json({ url, state });
      return;
    }
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
}

export async function oauthCallbackHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  // This endpoint MUST always end in a redirect to the web UI — never throw,
  // since the user's browser already navigated here from the provider.
  try {
    const query = callbackQuerySchema.parse(req.query);
    if (query.error) {
      logger.warn('[integrations] OAuth callback received provider error', {
        error: query.error,
        description: query.error_description,
      });
      res.redirect(302, buildSettingsRedirect('error', query.error));
      return;
    }
    if (!query.code || !query.state) {
      res.redirect(302, buildSettingsRedirect('error', 'missing_code_or_state'));
      return;
    }

    const integration = await mailboxService.completeOAuth(query.code, query.state);
    logger.info('[integrations] OAuth completed', {
      integrationId: integration.id,
      provider: integration.provider,
      tenantId: integration.tenant_id,
    });
    res.redirect(302, buildSettingsRedirect('success'));
  } catch (err) {
    const message = err instanceof AppError ? err.code : (err as Error).message;
    logger.error('[integrations] OAuth callback failed', { error: message });
    res.redirect(302, buildSettingsRedirect('error', encodeURIComponent(message ?? 'unknown')));
  }
}

export async function disconnectIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = idParamSchema.parse(req.params);
    await mailboxService.disconnectIntegration(
      req.user!.tenantId,
      req.user!.userId,
      id
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
