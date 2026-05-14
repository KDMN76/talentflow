/**
 * Centrale lijst van audit-action-strings.
 *
 * Door deze constants te gebruiken (i.p.v. losse string-literals in services)
 * voorkomen we typo's en kunnen we via TypeScript autocomplete consistent
 * blijven. Uitbreidbaar — nieuwe events worden hier toegevoegd zodra een
 * service ze emit.
 *
 * Naming-conventie: `{entity}.{verb_in_past_tense}`. Lowercase, dot-separator.
 */

export const AuditActions = {
  // ─── Candidates ─────────────────────────────────────────────────────────
  CANDIDATE_CREATED: 'candidate.created',
  CANDIDATE_UPDATED: 'candidate.updated',
  CANDIDATE_DELETED: 'candidate.deleted',
  CANDIDATE_RESUME_UPLOADED: 'candidate.resume_uploaded',
  CANDIDATE_RESUME_DELETED: 'candidate.resume_deleted',
  CANDIDATE_SKILL_ADDED: 'candidate.skill_added',
  CANDIDATE_SKILL_REMOVED: 'candidate.skill_removed',

  // ─── Jobs ───────────────────────────────────────────────────────────────
  JOB_CREATED: 'job.created',
  JOB_UPDATED: 'job.updated',
  JOB_FILLED: 'job.filled',
  JOB_DELETED: 'job.deleted',
  JOB_DUPLICATED: 'job.duplicated',

  // ─── Applications ───────────────────────────────────────────────────────
  APPLICATION_CREATED: 'application.created',
  APPLICATION_STAGE_CHANGED: 'application.stage_changed',
  APPLICATION_REJECTED: 'application.rejected',
  APPLICATION_HIRED: 'application.hired',

  // ─── Auth ───────────────────────────────────────────────────────────────
  USER_LOGGED_IN: 'user.logged_in',
  USER_LOGGED_OUT: 'user.logged_out',
  USER_INVITED: 'user.invited',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_PASSWORD_CHANGED: 'user.password_changed',

  // ─── Tenant lifecycle (Q1.2) ────────────────────────────────────────────
  TENANT_CREATED: 'tenant.created',

  // ─── Data export (Q1.2 — GDPR-bewijs dat data is geëxporteerd) ──────────
  DATA_EXPORTED: 'data.exported',

  // ─── AI compliance (Q1.2 — manual recruiter-aanvragen tellen
  //     voor het compliance dashboard).
  MATCH_EXPLANATION_GENERATED: 'match_explanation.generated',

  // ─── Compliance / Q2 ────────────────────────────────────────────────────
  CONSENT_GRANTED: 'consent.granted',
  CONSENT_WITHDRAWN: 'consent.withdrawn',
  GDPR_EXPORT_REQUESTED: 'gdpr.export_requested',
  GDPR_DELETION_REQUESTED: 'gdpr.deletion_requested',

  // ─── Sprint Q2.3 — Compliance layer ─────────────────────────────────────
  RETENTION_POLICY_CREATED: 'retention_policy.created',
  RETENTION_POLICY_UPDATED: 'retention_policy.updated',
  RETENTION_POLICY_DELETED: 'retention_policy.deleted',
  RETENTION_APPLIED: 'retention.applied',
  ANONYMIZATION_APPLIED: 'candidate.anonymized',
  RESUME_ANONYMIZED_FOR_SHARE: 'resume.anonymized_for_share',
  DSAR_REQUESTED: 'dsar.requested',
  DSAR_FULFILLED: 'dsar.fulfilled',
  DSAR_REJECTED: 'dsar.rejected',
  DATA_EXPORT_PACKAGE_GENERATED: 'data_export_package.generated',
  CONSENT_UPDATED_BY_CANDIDATE: 'consent.updated_by_candidate',
  CANDIDATE_CORRECTION_BY_CANDIDATE: 'candidate.correction_by_candidate',
  CANDIDATE_DELETION_REQUESTED_BY_CANDIDATE: 'candidate.deletion_requested_by_candidate',
  CANDIDATE_RETENTION_EXCLUDED: 'candidate.retention_excluded',
  CANDIDATE_RETENTION_INCLUDED: 'candidate.retention_included',
  CANDIDATE_SELF_TOKEN_GENERATED: 'candidate.self_token_generated',
  CANDIDATE_SELF_TOKEN_USED: 'candidate.self_token_used',

  // ─── Sprint Q1.2 — ATS-completering ─────────────────────────────────────
  CSV_IMPORT_STARTED: 'csv_import.started',
  CSV_IMPORT_COMPLETED: 'csv_import.completed',
  CSV_IMPORT_FAILED: 'csv_import.failed',
  CANDIDATE_MERGED: 'candidate.merged',
  CUSTOM_FIELD_CREATED: 'custom_field.created',
  CUSTOM_FIELD_UPDATED: 'custom_field.updated',
  CUSTOM_FIELD_DELETED: 'custom_field.deleted',
  CUSTOM_FIELD_VALUES_SET: 'custom_field.values_set',
  SCORECARD_SUBMITTED: 'scorecard.submitted',
  SCORECARD_DELETED: 'scorecard.deleted',
  SCORECARD_TEMPLATE_CREATED: 'scorecard_template.created',
  BULK_ACTION_PERFORMED: 'bulk_action.performed',
  JOB_TEMPLATE_CREATED: 'job_template.created',
  JOB_TEMPLATE_DELETED: 'job_template.deleted',
  JOB_INSTANTIATED_FROM_TEMPLATE: 'job.instantiated_from_template',
  SAVED_SEARCH_CREATED: 'saved_search.created',
  SAVED_SEARCH_DELETED: 'saved_search.deleted',

  // ─── Sprint Q2.4 — Push notifications ───────────────────────────────────
  PUSH_SUBSCRIPTION_CREATED: 'push_subscription.created',
  PUSH_SUBSCRIPTION_DELETED: 'push_subscription.deleted',
  NOTIFICATION_PREFERENCE_UPDATED: 'notification_preference.updated',

  // ─── Sprint Q3.1 — Mailbox integrations + bulk campaigns ────────────────
  MAILBOX_INTEGRATION_CONNECTED: 'mailbox_integration.connected',
  MAILBOX_INTEGRATION_DISCONNECTED: 'mailbox_integration.disconnected',
  MAILBOX_INTEGRATION_TOKEN_REFRESHED: 'mailbox_integration.token_refreshed',
  MAILBOX_INTEGRATION_INVALIDATED: 'mailbox_integration.invalidated',
  BULK_CAMPAIGN_STARTED: 'bulk_campaign.started',
  BULK_CAMPAIGN_COMPLETED: 'bulk_campaign.completed',

  // ─── Sprint Q3.3 — Talent Fit Model integratie ──────────────────────────
  // Geschreven door matching.service wanneer top-N kandidaten herrangschikt
  // zijn op combined_score (cosine + fit). Geen AI-call (alle Claude-events
  // worden al apart in ai_events gelogd) — dit is alleen een regular audit
  // event voor compliance dashboard / drift-monitoring.
  MATCH_RANKED_BY_TALENT_FIT: 'match.ranked',
  TALENT_FIT_MODEL_TRAINED: 'talent_fit_model.trained',
  TALENT_FIT_MODEL_TRAINING_SKIPPED: 'talent_fit_model.training_skipped',

  // ─── Sprint Q3.4 — AI Interview Suite ───────────────────────────────────
  INTERVIEW_SCHEDULED: 'interview.scheduled',
  INTERVIEW_RESCHEDULED: 'interview.rescheduled',
  INTERVIEW_CANCELLED: 'interview.cancelled',
  INTERVIEW_ATTENDANCE_LOGGED: 'interview.attendance_logged',
  INTERVIEW_KIT_CREATED: 'interview_kit.created',
  INTERVIEW_KIT_UPDATED: 'interview_kit.updated',
  INTERVIEW_KIT_DELETED: 'interview_kit.deleted',
  INTERVIEWER_AVAILABILITY_UPDATED: 'interviewer_availability.updated',
  // Recordings + calendar (Agent CCC)
  INTERVIEW_RECORDING_UPLOADED: 'interview_recording.uploaded',
  INTERVIEW_RECORDING_DELETED: 'interview_recording.deleted',
  INTERVIEW_CALENDAR_EVENT_CREATED: 'interview_calendar_event.created',
  INTERVIEW_CALENDAR_EVENT_UPDATED: 'interview_calendar_event.updated',
  INTERVIEW_CALENDAR_EVENT_DELETED: 'interview_calendar_event.deleted',

  // ─── Sprint Q3.5 — Custom Report Builder ────────────────────────────────
  REPORT_CREATED: 'report.created',
  REPORT_UPDATED: 'report.updated',
  REPORT_DELETED: 'report.deleted',
  REPORT_DUPLICATED: 'report.duplicated',
  REPORT_RUN: 'report.run',
  REPORT_EMBED_ENABLED: 'report.embed_enabled',
  REPORT_EMBED_DISABLED: 'report.embed_disabled',
  // Agent GGG additions — exporters + scheduling + embed-views
  REPORT_EXPORTED: 'report.exported',
  REPORT_SCHEDULE_SET: 'report.schedule_set',
  REPORT_SCHEDULE_CLEARED: 'report.schedule_cleared',
  REPORT_SCHEDULED_RUN: 'report.scheduled_run',
  REPORT_EMBED_VIEWED: 'report.embed_viewed',

  // ─── Sprint Q3.6 — Pay Transparency Directive 2026 + DEI ────────────────
  PAY_TRANSPARENCY_BLOCKED: 'pay_transparency.blocked',
  PAY_EQUITY_REPORT_GENERATED: 'pay_equity.report_generated',
  DEI_FUNNEL_REPORT_GENERATED: 'dei_funnel.report_generated',
  PAY_SETTINGS_UPDATED: 'pay_settings.updated',

  // ─── Sprint Q4.2 — Enterprise security (Agent NNN) ──────────────────────
  SSO_CONFIG_UPDATED: 'sso.config_updated',
  SSO_CONFIG_DISABLED: 'sso.config_disabled',
  SSO_LOGIN: 'sso.login',
  SSO_LOGIN_FAILED: 'sso.login_failed',
  USER_2FA_SETUP_INITIATED: 'user.2fa_setup_initiated',
  USER_2FA_ENABLED: 'user.2fa_enabled',
  USER_2FA_DISABLED: 'user.2fa_disabled',
  USER_2FA_VERIFIED: 'user.2fa_verified',
  USER_2FA_BACKUP_CODE_USED: 'user.2fa_backup_code_used',
  USER_2FA_BACKUP_CODES_REGENERATED: 'user.2fa_backup_codes_regenerated',
  TENANT_2FA_POLICY_UPDATED: 'tenant.2fa_policy_updated',
  SCIM_USER_CREATED: 'scim.user_created',
  SCIM_USER_UPDATED: 'scim.user_updated',
  SCIM_USER_DEACTIVATED: 'scim.user_deactivated',
  SCIM_USER_DELETED: 'scim.user_deleted',
  SCIM_GROUP_UPDATED: 'scim.group_updated',
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
