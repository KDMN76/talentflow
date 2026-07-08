/**
 * Tenant-aware e-mailverzending — kiest per tenant het juiste transport.
 *
 * Beslisboom (in volgorde):
 *   1. Geen tenantId              → globaal Resend-pad (emailService.sendEmail).
 *   2. Tenant-SMTP enabled + host → nodemailer naar de eigen SMTP-server van
 *      de tenant. Fouten bubbelen op → nette BullMQ job-failure + retry.
 *   3. Anders                     → Resend, maar met de per-tenant
 *      afzendernaam vóór het globale geverifieerde adres:
 *      "IT Proposal <no-reply@send.kdmn.nl>".
 *
 * Reply-To-voorrang: een per-tenant `reply_to` (bureau-adres, bv.
 * info@itproposal.be) wint ALTIJD van de meegegeven replyTo (de
 * plus-addressing uit buildReplyTo/RESEND_REPLY_DOMAIN). Inbound
 * reply-threading staat bewust uit, dus zonder deze override bouncen
 * kandidaat-antwoorden.
 *
 * Security: het SMTP-wachtwoord komt hier gedecrypt binnen via
 * getTenantSendSettings() en wordt NOOIT gelogd of in errors/responses gezet.
 */

import nodemailer from 'nodemailer';
import { AppError, logger } from '../middleware/errorHandler';
import {
  sendEmail,
  getDefaultFrom,
  type SendEmailParams,
} from './emailService';
import {
  getTenantSendSettings,
  extractAddress,
  type TenantSendSettings,
} from '../modules/tenants/emailSettings.service';
import { appendTenantEmailFooter } from './emailFooter';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TenantSendResult {
  messageId: string;
  provider: 'resend' | 'smtp';
  /** True wanneer de send lokaal gemockt is (dev zonder RESEND_API_KEY). */
  mocked?: boolean;
}

// ─── SMTP-doelvalidatie (SSRF-guard) ────────────────────────────────────────

/** Poorten die legitiem voor SMTP-submission gebruikt worden. */
export const ALLOWED_SMTP_PORTS: readonly number[] = [25, 465, 587, 2525];

function isPrivateOrReservedIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 (CGNAT)
    (a === 169 && b === 254) || // link-local + cloud-metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    a >= 224 // multicast/reserved
  );
}

/**
 * Weigert SMTP-doelen die naar interne infrastructuur wijzen (SSRF-guard).
 * Een tenant-admin is in een multi-tenant SaaS een externe partij; zonder
 * deze check kan die via het testmail-endpoint interne hosts benaderen
 * (postgres/redis/minio in het docker-netwerk, cloud-metadata, enz.).
 * Regels: geen IP-literals in private/reserved ranges, geen IPv6-literals,
 * geen hostnamen zonder punt (docker-servicenamen), geen localhost/.local/
 * .internal/.lan/.arpa, en alleen gangbare SMTP-poorten.
 * Residueel risico: DNS-rebinding blijft theoretisch mogelijk; de
 * poort-whitelist beperkt dat tot SMTP-handshakes zonder response-inhoud.
 * Wordt zowel bij het opslaan (PUT) als vlak vóór het verbinden afgedwongen.
 */
export function assertSafeSmtpTarget(
  host: string,
  port: number | null | undefined
): void {
  const reject = (reason: string): never => {
    throw new AppError(
      400,
      'SMTP_HOST_NOT_ALLOWED',
      `SMTP-host is niet toegestaan: ${reason}.`
    );
  };

  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) reject('leeg');
  if (h.includes(':') || h.startsWith('[')) reject('IPv6-literal');
  if (isPrivateOrReservedIpv4(h)) reject('privé/gereserveerd IP-adres');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    if (!h.includes('.')) reject('interne hostnaam zonder domein');
    if (
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      h.endsWith('.lan') ||
      h.endsWith('.arpa')
    ) {
      reject('interne/lokale hostnaam');
    }
  }
  if (port != null && !ALLOWED_SMTP_PORTS.includes(port)) {
    throw new AppError(
      400,
      'SMTP_PORT_NOT_ALLOWED',
      `SMTP-poort ${port} is niet toegestaan (toegestaan: ${ALLOWED_SMTP_PORTS.join(', ')}).`
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Bouwt "Display Naam <adres>" met een gesaneerde display-naam (geen quotes
 * of newlines — voorkomt header-injectie via de settings-UI).
 */
export function formatFrom(name: string | null | undefined, address: string): string {
  const clean = (name ?? '').replace(/["<>\r\n]/g, '').trim();
  if (!clean) return address;
  return `${clean} <${address}>`;
}

/** Afzender voor het Resend-pad: tenant-naam + globaal geverifieerd adres. */
function resolveResendFrom(settings: TenantSendSettings | null): string | undefined {
  if (!settings?.fromName) return undefined; // → emailService default
  return formatFrom(settings.fromName, extractAddress(getDefaultFrom()));
}

/** Afzender voor het SMTP-pad: smtp_from > smtp_user, met display-naam. */
function resolveSmtpFrom(settings: TenantSendSettings): string {
  const smtp = settings.smtp!;
  const address = smtp.from ?? smtp.user ?? extractAddress(getDefaultFrom());
  return formatFrom(settings.fromName, address);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Verzendt een e-mail volgens de e-mailinstellingen van de tenant.
 *
 * @param tenantId  Tenant-UUID, of null/undefined voor het globale pad.
 * @param params    Zelfde shape als emailService.sendEmail.
 */
export async function sendTenantEmail(
  tenantId: string | null | undefined,
  params: SendEmailParams
): Promise<TenantSendResult> {
  if (!tenantId) {
    return sendEmail(params);
  }

  const settings = await getTenantSendSettings(tenantId);

  // Per-tenant Reply-To wint van plus-addressing (RESEND_REPLY_DOMAIN).
  const replyTo = settings?.replyTo ?? params.replyTo;

  // Tenant-branding e-mail-footer: gesaneerd (strikte allowlist) appenden aan
  // html + text. Fail-open en dubbel-append-proof — zie lib/emailFooter.ts.
  const body = await appendTenantEmailFooter(tenantId, {
    html: params.html,
    text: params.text,
  });

  // ── Pad 1: eigen SMTP-server van de tenant ────────────────────────────────
  if (settings?.smtp) {
    const smtp = settings.smtp;
    // Defense-in-depth: ook bij verzending valideren (dekt rijen die vóór
    // de PUT-validatie zijn opgeslagen).
    assertSafeSmtpTarget(smtp.host, smtp.port ?? (smtp.secure ? 465 : 587));
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port ?? (smtp.secure ? 465 : 587),
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
      // Hang niet eindeloos op een onbereikbare server — laat BullMQ retryen.
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });

    try {
      const headers: Record<string, string> = {};
      if (params.inReplyTo) headers['In-Reply-To'] = params.inReplyTo;
      if (params.references && params.references.length > 0) {
        headers['References'] = params.references.join(' ');
      }

      const info = await transport.sendMail({
        from: resolveSmtpFrom(settings),
        to: params.to,
        subject: params.subject,
        html: body.html,
        text: body.text,
        replyTo,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      logger.info('[tenantMailer] verzonden via tenant-SMTP', {
        tenantId,
        host: smtp.host,
        to: params.to,
        messageId: info.messageId,
      });
      return { messageId: info.messageId, provider: 'smtp' };
    } catch (err) {
      // Nette job-failure: bubble de fout op zodat de worker 'm als failed
      // markeert en BullMQ het bestaande retry-gedrag toepast. Loggen ZONDER
      // credentials — alleen host + foutboodschap.
      logger.error('[tenantMailer] tenant-SMTP send mislukt', {
        tenantId,
        host: smtp.host,
        to: params.to,
        error: (err as Error).message,
      });
      throw new Error(`Tenant-SMTP fout (${smtp.host}): ${(err as Error).message}`);
    } finally {
      transport.close();
    }
  }

  // ── Pad 2: Resend met per-tenant afzendernaam (of globale default) ───────
  return sendEmail({
    ...params,
    html: body.html,
    text: body.text,
    from: params.from ?? resolveResendFrom(settings),
    replyTo,
  });
}
