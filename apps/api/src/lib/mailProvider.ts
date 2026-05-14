/**
 * MailProvider — uniform interface voor persoonlijke mailbox-integraties.
 *
 * Beide providers (Gmail, Outlook) implementeren dezelfde shape zodat de
 * service-laag (`mailbox.service.ts`, `inboxSync.worker.ts`,
 * `bulkCampaign.service.ts`) provider-agnostisch is.
 *
 * Design choices:
 *   - OAuth2-flow is **stateless**: caller bewaart `state` in Redis (TTL 10min)
 *     zodat de callback de tenant + user kan terugvinden.
 *   - `listMessagesSince` neemt zowel een `cursor` (Gmail historyId / Outlook
 *     deltaLink) als een fallback `since` (gebruikt bij eerste sync, geen
 *     cursor beschikbaar).
 *   - `ProviderMessage` is een neutrale shape — geen Gmail/Outlook-specifieke
 *     velden lekken naar de service-laag.
 *   - Tokens worden NOOIT in deze interface gepersisteerd. De service-laag is
 *     verantwoordelijk voor opslag (DB) en refresh-cycli.
 */

export interface TokenResponse {
  access_token: string;
  /** Optional: bij refresh-flows komt soms geen nieuwe refresh_token terug. */
  refresh_token?: string;
  /** Levensduur van het access_token in seconden. */
  expires_in: number;
  scope: string;
  account_email?: string;
  account_name?: string;
}

export interface ProviderAttachment {
  filename: string;
  content_type: string;
  size: number;
  data?: Buffer;
}

export interface ProviderMessage {
  id: string;
  thread_id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
  in_reply_to?: string;
  message_id_header?: string;
  received_at: Date;
  attachments?: ProviderAttachment[];
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
}

export interface SendEmailResult {
  messageId: string;
  threadId: string;
}

export interface ListMessagesResult {
  messages: ProviderMessage[];
  nextCursor?: string;
}

export interface MailProvider {
  /** OAuth-flow start: bouw provider-authorize-URL. */
  getAuthUrl(state: string): string;
  /** OAuth-flow afronden: code → tokens + profielinfo. */
  exchangeCode(code: string): Promise<TokenResponse>;
  /** Refresh access_token a.h.v. refresh_token. */
  refreshAccessToken(refreshToken: string): Promise<TokenResponse>;
  /** Profielinfo ophalen (email, name) — gebruikt bij OAuth-completion. */
  getProfile(accessToken: string): Promise<{ email: string; name?: string }>;
  /** Mail versturen via persoonlijke mailbox. */
  sendEmail(accessToken: string, params: SendEmailParams): Promise<SendEmailResult>;
  /**
   * List messages since cursor of since-tijdstip.
   *  - cursor (Gmail historyId / Outlook deltaLink) → incrementele sync.
   *  - since (Date)                                 → eerste sync (laatste 30d default).
   */
  listMessagesSince(
    accessToken: string,
    cursor?: string,
    since?: Date
  ): Promise<ListMessagesResult>;
  /** Single message ophalen — voor parse + thread-matching. */
  getMessage(accessToken: string, messageId: string): Promise<ProviderMessage>;
}

/** Provider-discriminator gebruikt in DB + factory. */
export type MailProviderName = 'gmail' | 'outlook';
