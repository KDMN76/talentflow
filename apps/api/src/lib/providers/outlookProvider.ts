/**
 * Outlook provider — implementeert MailProvider via @azure/msal-node (OAuth)
 * en @microsoft/microsoft-graph-client (mail-ops).
 *
 * Authenticatie: ConfidentialClientApplication (web-flow) met
 * `auth-code-flow` + offline_access voor refresh-tokens.
 *
 * Scopes:
 *   - https://graph.microsoft.com/Mail.Read
 *   - https://graph.microsoft.com/Mail.Send
 *   - https://graph.microsoft.com/User.Read
 *   - offline_access (voor refresh)
 *
 * Quotas (Graph throttling):
 *   - 10.000 requests / 10 minuten / app + user combinatie.
 *   - bij 429: respect 'Retry-After' header.
 *   - bulk-mail rate-limit (1/sec/user) is veilig — 60/min ≪ throttling.
 *
 * Mock-mode: ontbrekende AZURE_AD_CLIENT_ID/SECRET → mockmode (provider
 * gooit duidelijke errors die de service-laag in 501 vertaalt).
 */

import {
  ConfidentialClientApplication,
  Configuration,
  AuthorizationCodeRequest,
  RefreshTokenRequest,
} from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';
// node 18+ heeft fetch globaal, maar ms-graph-client typed legacy fetch.
// `isomorphic-fetch` is reeds in deps; we polyfillen lazily.
import 'isomorphic-fetch';
import {
  MailProvider,
  ProviderMessage,
  SendEmailParams,
  SendEmailResult,
  ListMessagesResult,
  TokenResponse,
} from '../mailProvider';
import { logger } from '../../middleware/errorHandler';

const OUTLOOK_SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];

interface OutlookEnv {
  clientId: string;
  clientSecret: string;
  tenantAuthority: string;
  redirectUri: string;
}

function getEnv(): OutlookEnv | null {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  // 'common' = werkt voor zowel work als personal MS accounts.
  const tenantAuthority =
    process.env.AZURE_AD_AUTHORITY ?? 'https://login.microsoftonline.com/common';
  const redirectUri =
    process.env.AZURE_AD_REDIRECT_URI ??
    `${process.env.API_BASE_URL ?? 'http://localhost:4000'}/api/integrations/mailbox/oauth/callback`;
  return { clientId, clientSecret, tenantAuthority, redirectUri };
}

export function isOutlookMockMode(): boolean {
  return getEnv() === null;
}

function getMsalClient(): ConfidentialClientApplication {
  const env = getEnv();
  if (!env) {
    throw new Error('Outlook OAuth not configured (AZURE_AD_CLIENT_ID missing)');
  }
  const config: Configuration = {
    auth: {
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      authority: env.tenantAuthority,
    },
  };
  return new ConfidentialClientApplication(config);
}

function getAuthUrl(state: string): string {
  const env = getEnv();
  if (!env) {
    logger.warn(
      '[outlookProvider] running in MOCK mode — AZURE_AD_CLIENT_ID/SECRET not set'
    );
    return '/api/integrations/mailbox/oauth/callback?mock=outlook';
  }
  // MSAL exposes async `getAuthCodeUrl`. Our interface is sync — we cache
  // the result via a sync URL builder using documented OAuth endpoints.
  // (msal's getAuthCodeUrl is async — we build the URL ourselves to keep
  // the interface contract.)
  const params = new URLSearchParams({
    client_id: env.clientId,
    response_type: 'code',
    redirect_uri: env.redirectUri,
    response_mode: 'query',
    scope: OUTLOOK_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  return `${env.tenantAuthority}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const env = getEnv();
  if (!env) throw new Error('Outlook OAuth not configured');
  const msal = getMsalClient();
  const req: AuthorizationCodeRequest = {
    code,
    scopes: OUTLOOK_SCOPES,
    redirectUri: env.redirectUri,
  };
  const result = await msal.acquireTokenByCode(req);
  if (!result || !result.accessToken) {
    throw new Error('Outlook token-exchange leverde geen access_token op');
  }
  // MSAL's token-cache houdt de refresh_token vast — we vissen 'm uit de
  // serialized cache zodat we 'm in onze eigen DB kunnen opslaan.
  const refreshToken = extractRefreshToken(msal);
  if (!refreshToken) {
    throw new Error('Outlook token-exchange leverde geen refresh_token op (offline_access scope?)');
  }
  return {
    access_token: result.accessToken,
    refresh_token: refreshToken,
    expires_in: result.expiresOn
      ? Math.max(60, Math.floor((result.expiresOn.getTime() - Date.now()) / 1000))
      : 3600,
    scope: result.scopes?.join(' ') ?? OUTLOOK_SCOPES.join(' '),
    account_email: result.account?.username,
    account_name: result.account?.name,
  };
}

function extractRefreshToken(msal: ConfidentialClientApplication): string | undefined {
  // MSAL serializes its token cache as JSON. We parse and pluck het meest
  // recente RefreshToken-record.
  try {
    const raw = msal.getTokenCache().serialize();
    const parsed = JSON.parse(raw) as {
      RefreshToken?: Record<string, { secret?: string }>;
    };
    const tokens = parsed.RefreshToken;
    if (!tokens) return undefined;
    const first = Object.values(tokens)[0];
    return first?.secret;
  } catch (err) {
    logger.warn('[outlookProvider] failed to extract refresh token', {
      error: (err as Error).message,
    });
    return undefined;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const env = getEnv();
  if (!env) throw new Error('Outlook OAuth not configured');
  const msal = getMsalClient();
  const req: RefreshTokenRequest = {
    refreshToken,
    scopes: OUTLOOK_SCOPES,
  };
  const result = await msal.acquireTokenByRefreshToken(req);
  if (!result || !result.accessToken) {
    throw new Error('Outlook refresh leverde geen access_token op');
  }
  // Een nieuwe refresh-token kan optioneel meekomen — we lezen 'm uit de cache.
  const newRefresh = extractRefreshToken(msal);
  return {
    access_token: result.accessToken,
    refresh_token: newRefresh ?? undefined,
    expires_in: result.expiresOn
      ? Math.max(60, Math.floor((result.expiresOn.getTime() - Date.now()) / 1000))
      : 3600,
    scope: result.scopes?.join(' ') ?? OUTLOOK_SCOPES.join(' '),
  };
}

function graphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

async function getProfile(
  accessToken: string
): Promise<{ email: string; name?: string }> {
  const c = graphClient(accessToken);
  const me: { mail?: string; userPrincipalName?: string; displayName?: string } =
    await c.api('/me').get();
  const email = me.mail ?? me.userPrincipalName;
  if (!email) throw new Error('Outlook /me bevatte geen email');
  return { email, name: me.displayName };
}

async function sendEmail(
  accessToken: string,
  params: SendEmailParams
): Promise<SendEmailResult> {
  const c = graphClient(accessToken);

  // Als we threadId hebben, gebruiken we /me/messages/{id}/reply om in de
  // bestaande conversation te blijven. Anders /me/sendMail.
  if (params.threadId && params.inReplyTo) {
    // Microsoft Graph reply gebruikt het bestaande message als parent.
    // We doen `createReply` → `update` (om body aan te passen) → `send`.
    try {
      const draft: { id?: string; conversationId?: string } = await c
        .api(`/me/messages/${params.inReplyTo}/createReply`)
        .post({});
      if (!draft.id) throw new Error('createReply leverde geen draft op');
      await c.api(`/me/messages/${draft.id}`).patch({
        subject: params.subject,
        body: { contentType: 'HTML', content: params.html },
      });
      await c.api(`/me/messages/${draft.id}/send`).post({});
      return {
        messageId: draft.id,
        threadId: draft.conversationId ?? params.threadId,
      };
    } catch (err) {
      logger.warn(
        '[outlookProvider] reply via /createReply mislukte, val terug op sendMail',
        { error: (err as Error).message }
      );
    }
  }

  await c.api('/me/sendMail').post({
    message: {
      subject: params.subject,
      body: { contentType: 'HTML', content: params.html },
      toRecipients: [{ emailAddress: { address: params.to } }],
    },
    saveToSentItems: true,
  });

  // /me/sendMail returns 202 zonder id. We zoeken het meest recente
  // verzonden bericht op om id+conversationId te krijgen.
  try {
    const sent: { value?: Array<{ id: string; conversationId: string }> } = await c
      .api(`/me/mailFolders/sentitems/messages?$top=1&$orderby=sentDateTime desc`)
      .get();
    const m = sent.value?.[0];
    if (m) {
      return { messageId: m.id, threadId: m.conversationId };
    }
  } catch (err) {
    logger.warn('[outlookProvider] post-send lookup mislukte', {
      error: (err as Error).message,
    });
  }
  // Fallback — synthetic ids zodat caller-flow niet stuk gaat.
  const synthetic = `outlook-${Date.now()}`;
  return { messageId: synthetic, threadId: params.threadId ?? synthetic };
}

interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
  receivedDateTime?: string;
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  hasAttachments?: boolean;
}

function parseGraphMessage(m: GraphMessage): ProviderMessage {
  const isHtml = m.body?.contentType?.toLowerCase() === 'html';
  let inReplyTo: string | undefined;
  for (const h of m.internetMessageHeaders ?? []) {
    if (h.name.toLowerCase() === 'in-reply-to') inReplyTo = h.value;
  }
  return {
    id: m.id,
    thread_id: m.conversationId ?? m.id,
    from:
      m.from?.emailAddress?.address ??
      m.from?.emailAddress?.name ??
      '',
    to:
      m.toRecipients
        ?.map((r) => r.emailAddress?.address)
        .filter((s): s is string => Boolean(s)) ?? [],
    cc:
      m.ccRecipients
        ?.map((r) => r.emailAddress?.address)
        .filter((s): s is string => Boolean(s)) ?? [],
    subject: m.subject ?? '',
    body_html: isHtml ? m.body?.content : undefined,
    body_text: isHtml ? undefined : m.body?.content,
    in_reply_to: inReplyTo,
    message_id_header: m.internetMessageId,
    received_at: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
  };
}

async function getMessage(
  accessToken: string,
  messageId: string
): Promise<ProviderMessage> {
  const c = graphClient(accessToken);
  const m: GraphMessage = await c
    .api(`/me/messages/${messageId}`)
    .select(
      'id,conversationId,subject,body,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,internetMessageHeaders,hasAttachments'
    )
    .get();
  return parseGraphMessage(m);
}

async function listMessagesSince(
  accessToken: string,
  cursor?: string,
  since?: Date
): Promise<ListMessagesResult> {
  const c = graphClient(accessToken);

  // Outlook delta: cursor is een volledige delta-URL of skiptoken.
  // Eerste call: /me/mailFolders('Inbox')/messages/delta
  // Vervolgcalls: gebruik de deltaLink uit de vorige response.
  let deltaLink = cursor;
  let pageUrl = deltaLink ?? `/me/mailFolders('Inbox')/messages/delta`;
  if (!deltaLink && since) {
    const iso = since.toISOString();
    pageUrl = `/me/mailFolders('Inbox')/messages/delta?$filter=receivedDateTime ge ${iso}`;
  } else if (!deltaLink) {
    // 30-day default
    const def = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    pageUrl = `/me/mailFolders('Inbox')/messages/delta?$filter=receivedDateTime ge ${def}`;
  }

  const messages: ProviderMessage[] = [];
  let nextCursor: string | undefined;

  // Pagineer alle pagina's tot we een @odata.deltaLink terugkrijgen.
  let safety = 20; // hard cap to prevent runaways
  while (pageUrl && safety-- > 0) {
    // Both relative paths and absolute URLs are accepted by `c.api()`.
    const builder = c.api(pageUrl);
    const page: {
      value?: GraphMessage[];
      ['@odata.nextLink']?: string;
      ['@odata.deltaLink']?: string;
    } = await builder.get();

    for (const m of page.value ?? []) {
      // Delta kan ook deletions teruggeven (with @removed). Simpele guard:
      if (!m.id) continue;
      messages.push(parseGraphMessage(m));
    }

    if (page['@odata.deltaLink']) {
      nextCursor = page['@odata.deltaLink'];
      break;
    }
    if (page['@odata.nextLink']) {
      pageUrl = page['@odata.nextLink'];
      continue;
    }
    break;
  }

  return { messages, nextCursor };
}

export const outlookProvider: MailProvider = {
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getProfile,
  sendEmail,
  listMessagesSince,
  getMessage,
};
