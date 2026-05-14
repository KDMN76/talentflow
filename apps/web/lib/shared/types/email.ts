/**
 * Email-related shared types. Mirrors the database schema for `email_templates`
 * and the `POST /api/communications/send` payload for outbound transactional
 * email (built on top of the existing communications module).
 *
 * Templates support double-curly merge variables (e.g. `{{candidate.first_name}}`,
 * `{{job.title}}`, `{{recruiter.name}}`) which are resolved server-side at send
 * time and on the client-side by `applyMergeVariables` in
 * `packages/shared/src/lib/mergeVariables.ts` for live previews.
 */

export type EmailTemplateCategory =
  | 'invite'
  | 'reject'
  | 'offer'
  | 'general';

/**
 * Persisted email template. The `category` field uses the union above for the
 * built-in categories but tolerates `string` so tenants can introduce custom
 * tags without a schema migration.
 */
export interface EmailTemplate {
  id: string;
  tenant_id: string;
  name: string;
  subject: string;
  /** Rich HTML body. Allowed to contain merge-variable placeholders. */
  body_html: string;
  /** Optional plain-text fallback used by clients that block HTML. */
  body_text: string | null;
  /** Detected merge-variable keys (e.g. `["candidate.first_name", "job.title"]`). */
  merge_variables: string[];
  category: EmailTemplateCategory | string;
  created_at: string;
  updated_at: string;
}

/** Payload accepted by `POST /api/email-templates`. */
export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  category: EmailTemplateCategory | string;
  /**
   * Optional explicit merge-variable list. When omitted, the API derives it
   * from the body and subject by scanning for `{{...}}` placeholders.
   */
  merge_variables?: string[];
}

/** Payload accepted by `PATCH /api/email-templates/:id` (all fields optional). */
export type UpdateEmailTemplateInput = Partial<CreateEmailTemplateInput>;

/**
 * Payload accepted by `POST /api/communications/send`.
 *
 * If `template_id` is provided the server will load the template, apply merge
 * variables resolved from `candidate_id` (and the current recruiter / tenant
 * context), and use the resulting subject/body unless `subject` / `body_html`
 * are supplied as overrides.
 */
export interface SendEmailInput {
  candidate_id: string;
  template_id?: string;
  subject: string;
  body_html: string;
}
