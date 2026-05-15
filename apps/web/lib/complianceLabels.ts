/**
 * Static UI translation labels for the compliance domain.
 *
 * These are NL i18n strings — NOT mock test data. They are safe to ship to
 * production and are kept here so that compliance components never need to
 * import value-exports from `lib/mockData.ts`.
 */

import type {
  AuditAction,
  DsarStatus,
  DsarRequestType,
  RetentionAction,
  RetentionEntityType,
  RetentionTriggerField,
} from "./mockData";

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "consent.granted": "Toestemming verleend",
  "consent.withdrawn": "Toestemming ingetrokken",
  "consent.requested": "Toestemming opgevraagd",
  "candidate.created": "Kandidaat aangemaakt",
  "candidate.updated": "Kandidaat bijgewerkt",
  "candidate.anonymized": "Kandidaat geanonimiseerd",
  "candidate.retention_excluded": "Uitgesloten van retention",
  "dsar.created": "DSAR-verzoek aangemaakt",
  "dsar.updated": "DSAR-verzoek bijgewerkt",
  "dsar.fulfilled": "DSAR-verzoek vervuld",
  "retention_policy.created": "Bewaarbeleid aangemaakt",
  "retention_policy.updated": "Bewaarbeleid bijgewerkt",
  "retention_policy.deleted": "Bewaarbeleid verwijderd",
  "user.login": "Ingelogd",
  "user.logout": "Uitgelogd",
  "export.downloaded": "Export gedownload",
};

export const DSAR_STATUS_LABELS: Record<DsarStatus, string> = {
  pending: "Open",
  in_progress: "In behandeling",
  fulfilled: "Vervuld",
  rejected: "Geweigerd",
};

export const DSAR_TYPE_LABELS: Record<DsarRequestType, string> = {
  access: "Inzage",
  export: "Export",
  correction: "Correctie",
  deletion: "Verwijdering",
};

export const RETENTION_ENTITY_LABELS: Record<RetentionEntityType, string> = {
  candidate: "Kandidaten",
  rejected_candidate: "Afgewezen kandidaten",
  application: "Sollicitaties",
  communication: "Communicatie-berichten",
};

export const RETENTION_TRIGGER_LABELS: Record<RetentionTriggerField, string> = {
  last_activity_at: "Laatste activiteit",
  created_at: "Aanmaakdatum",
  rejected_at: "Afwijzingsdatum",
};

export const RETENTION_ACTION_LABELS: Record<RetentionAction, string> = {
  archive: "Archiveren",
  anonymize: "Anonimiseren",
  delete: "Permanent verwijderen",
};
