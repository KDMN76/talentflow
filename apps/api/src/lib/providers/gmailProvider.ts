/**
 * Gmail provider — implementeert MailProvider via `googleapis`.
 *
 * Authenticatie: OAuth2 client (web-flow), redirect_uri komt uit
 * GOOGLE_OAUTH_REDIRECT_URI env. Scopes:
 *   - gmail.send       — versturen
 *   - gmail.modify     — labels (toekomstig)
 *   - gmail.readonly   — lezen voor inbox-sync
 *   - userinfo.email + profile — voor `getProfile`
 *
 * Quotas (https://developers.google.com/gmail/api/reference/quota):
 *   - 1.000.000.000 quota-units / dag / project (zacht).
 *   - 250 quota-units / seconde / user (hard).
 *   - messages.send = 100 units, messages.list = 5, messages.get = 5,
 *     history.list = 2.
 *   → bulk-mail rate-limit (1/sec/user) is veilig binnen 250 units/sec/user.
 *
 * Mock-mode: als GOOGLE_OAUTH_CLIENT_ID/SECRET niet gezet zijn, exporteren
 * we een no-op provider die throws — de service-laag detecteert dit via
 * `isMockMode()` en geeft een nette 501 terug.
 */

import { google, gmail_v1, Auth } from 'googleapis';
import {
  MailProvider,
  ProviderMessage,
  SendEmailParams,
  SendEmailResult,
  ListMessagesResult,
  TokenResponse,
} from '../mailProvider';
import { logger } from '../../middleware/errorHandler';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function getClientCredentials(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${process.env.API_BASE_URL ?? 'http://localhost:4000'}/api/integrations/mailbox/oauth/callback`;
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGmailMockMode(): boolean {
  return getClientCredentials() === null;
}

function buildOAuth2Client(): Auth.OAuth2Client {
  const creds = getClientCredentials();
  if (!creds) {
    logger.warn(
      '[gmailProvider] running in MOCK mode — GOOGLE_OAUTH_CLIENT_ID/SECRET not set'
    );
    // Return a dummy client — methods that hit the network will throw.
    return new google.auth.OAuth2('mock', 'mock', 'http://localhost/mock');
  }
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, creds.redirectUri);
}

function getAuthUrl(state: string): string {
  const oauth2 = buildOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  if (isGmailMockMode()) {
    throw new Error('Gmail OAuth not configured (GOOGLE_OAUTH_CLIENT_ID missing)');
  }
  const oauth2 = buildOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Gmail token-exchange leverde geen volledige tokens op');
  }
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expiry_date
      ? Math.max(60, Math.floor((tokens.expiry_date - Date.now()) / 1000))
      : 3600,
    scope: tokens.scope ?? GMAIL_SCOPES.join(' '),
  };
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  if (isGmailMockMode()) {
    throw new Error('Gmail OAuth not configured');
  }
  const oauth2 = buildOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('Gmail refresh leverde geen access_token op');
  }
  return {
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token ?? undefined,
    expires_in: credentials.expiry_date
      ? Math.max(60, Math.floor((credentials.expiry_date - Date.now()) / 1000))
      : 3600,
    scope: credentials.scope ?? GMAIL_SCOPES.join(' '),
  };
}

function withAuth(accessToken: string): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth });
}

async function getProfile(
  accessToken: string
): Promise<{ email: string; name?: string }> {
  const oauth = new google.auth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) {
    throw new Error('Gmail userinfo bevatte geen email');
  }
  return { email: data.email, name: data.name ?? undefined };
}

// ─── MIME compose helper (RFC 2822 multipart/alternative — text + html) ────

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildMimeMessage(params: {
  from?: string;
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const boundary = `tf_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [];
  if (params.from) lines.push(`From: ${params.from}`);
  lines.push(`To: ${params.to}`);
  lines.push(`Subject: ${encodeRfc2047(params.subject)}`);
  lines.push('MIME-Version: 1.0');
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push('');
  // text-fallback (strip tags)
  const text = params.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(text);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/html; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(params.html);
  lines.push('');
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

function encodeRfc2047(s: string): string {
  // Alleen encoden als non-ASCII chars aanwezig zijn.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

async function sendEmail(
  accessToken: string,
  params: SendEmailParams
): Promise<SendEmailResult> {
  const gmail = withAuth(accessToken);
  const mime = buildMimeMessage({
    to: params.to,
    subject: params.subject,
    html: params.html,
    inReplyTo: params.inReplyTo,
    references: params.inReplyTo,
  });
  const raw = base64UrlEncode(mime);
  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      threadId: params.threadId,
    },
  });
  if (!res.data.id || !res.data.threadId) {
    throw new Error('Gmail send leverde geen id/threadId op');
  }
  return { messageId: res.data.id, threadId: res.data.threadId };
}

// ─── Message listing + parsing ─────────────────────────────────────────────

interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === lower) {
      return h.value ?? undefined;
    }
  }
  return undefined;
}

function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): {
  html?: string;
  text?: string;
  attachments: ProviderMessage['attachments'];
} {
  const result: { html?: string; text?: string; attachments: NonNullable<ProviderMessage['attachments']> } = {
    attachments: [],
  };
  if (!payload) return result;

  const walk = (part: gmail_v1.Schema$MessagePart): void => {
    const mime = part.mimeType ?? '';
    if (mime === 'text/html' && part.body?.data) {
      result.html = decodeBase64Url(part.body.data);
    } else if (mime === 'text/plain' && part.body?.data) {
      result.text = decodeBase64Url(part.body.data);
    } else if (part.filename && part.body?.attachmentId) {
      result.attachments.push({
        filename: part.filename,
        content_type: mime,
        size: part.body.size ?? 0,
      });
    }
    if (part.parts) for (const sub of part.parts) walk(sub);
  };
  walk(payload);
  return result;
}

function parseAddresses(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseGmailMessage(msg: gmail_v1.Schema$Message): ProviderMessage {
  const headers = msg.payload?.headers as GmailHeader[] | undefined;
  const body = extractBody(msg.payload);
  const internalDate = msg.internalDate ? new Date(parseInt(msg.internalDate, 10)) : new Date();
  return {
    id: msg.id ?? '',
    thread_id: msg.threadId ?? '',
    from: getHeader(headers, 'From') ?? '',
    to: parseAddresses(getHeader(headers, 'To')),
    cc: parseAddresses(getHeader(headers, 'Cc')),
    subject: getHeader(headers, 'Subject') ?? '',
    body_html: body.html,
    body_text: body.text,
    in_reply_to: getHeader(headers, 'In-Reply-To'),
    message_id_header: getHeader(headers, 'Message-ID'),
    received_at: internalDate,
    attachments: body.attachments && body.attachments.length > 0 ? body.attachments : undefined,
  };
}

async function getMessage(
  accessToken: string,
  messageId: string
): Promise<ProviderMessage> {
  const gmail = withAuth(accessToken);
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return parseGmailMessage(data);
}

async function listMessagesSince(
  accessToken: string,
  cursor?: string,
  since?: Date
): Promise<ListMessagesResult> {
  const gmail = withAuth(accessToken);
  const messageIds: string[] = [];
  let nextHistoryId: string | undefined;

  if (cursor) {
    // Incremental via historyId.
    try {
      const { data } = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: cursor,
        historyTypes: ['messageAdded'],
      });
      nextHistoryId = data.historyId ?? undefined;
      for (const h of data.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          if (m.message?.id) messageIds.push(m.message.id);
        }
      }
    } catch (err) {
      const status = (err as { code?: number; status?: number }).code
        ?? (err as { code?: number; status?: number }).status;
      if (status === 404 || status === 410) {
        // historyId expired — fall back to since-window
        logger.warn('[gmailProvider] historyId expired, falling back to since-window');
      } else {
        throw err;
      }
    }
  }

  if (!cursor || messageIds.length === 0 && !nextHistoryId) {
    // Eerste sync of fallback: laatste 30 dagen.
    const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const epoch = Math.floor(sinceDate.getTime() / 1000);
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${epoch} -in:sent`,
      maxResults: 100,
    });
    for (const m of data.messages ?? []) {
      if (m.id) messageIds.push(m.id);
    }
    // Get current historyId om volgende sync incrementeel te maken.
    if (!nextHistoryId) {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      nextHistoryId = profile.data.historyId ?? undefined;
    }
  }

  // Hydrate de messages — voorkom duplicaten.
  const seen = new Set<string>();
  const messages: ProviderMessage[] = [];
  for (const id of messageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      messages.push(await getMessage(accessToken, id));
    } catch (err) {
      logger.warn('[gmailProvider] failed to fetch message', {
        id,
        error: (err as Error).message,
      });
    }
  }

  return { messages, nextCursor: nextHistoryId };
}

export const gmailProvider: MailProvider = {
  getAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getProfile,
  sendEmail,
  listMessagesSince,
  getMessage,
};
