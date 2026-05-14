/**
 * Mini i18n lookup — Sprint Q2.2.
 *
 * The public career-page renderer needs ~20 strings translated between
 * Dutch and English. We deliberately avoid pulling in i18next / react-intl
 * for the public bundle because:
 *  - Career-page locale is decided server-side (one render, one locale);
 *  - Bundle weight matters for first-paint on candidate-facing pages;
 *  - String count is small enough to maintain inline.
 *
 * If we ever need plurals/interpolation beyond simple `{key}` placeholders,
 * upgrade to a real i18n lib — until then, this stays.
 */

import type { Locale } from "./types";

export type I18nKey =
  | "apply_button"
  | "view_jobs"
  | "open_positions"
  | "open_positions_count_one"
  | "open_positions_count_other"
  | "no_jobs_title"
  | "no_jobs_subtitle"
  | "back_to_overview"
  | "job_details"
  | "department"
  | "location"
  | "employment_type"
  | "salary"
  | "remote_friendly"
  | "apply_now"
  | "application_form_title"
  | "name_label"
  | "email_label"
  | "phone_label"
  | "cover_letter_label"
  | "resume_label"
  | "resume_hint"
  | "consent_label"
  | "consent_link"
  | "submit"
  | "submitting"
  | "cancel"
  | "success_title"
  | "success_body"
  | "success_close"
  | "error_generic"
  | "error_required"
  | "error_email"
  | "error_phone"
  | "error_file_size"
  | "error_file_type"
  | "powered_by"
  | "privacy_policy"
  | "page_not_found_title"
  | "page_not_found_body"
  | "page_unavailable_title"
  | "page_unavailable_body"
  | "footer_copyright"
  | "language_switcher_label";

const STRINGS: Record<Locale, Record<I18nKey, string>> = {
  nl: {
    apply_button: "Solliciteren",
    view_jobs: "Bekijk vacatures",
    open_positions: "Open vacatures",
    open_positions_count_one: "{n} openstaande positie",
    open_positions_count_other: "{n} openstaande posities",
    no_jobs_title: "Op dit moment geen vacatures",
    no_jobs_subtitle: "Kom later terug — we groeien snel.",
    back_to_overview: "Terug naar alle vacatures",
    job_details: "Functiedetails",
    department: "Afdeling",
    location: "Locatie",
    employment_type: "Dienstverband",
    salary: "Salaris",
    remote_friendly: "Remote mogelijk",
    apply_now: "Solliciteer nu",
    application_form_title: "Vul je sollicitatie in",
    name_label: "Volledige naam",
    email_label: "E-mailadres",
    phone_label: "Telefoonnummer",
    cover_letter_label: "Motivatiebrief",
    resume_label: "Upload je CV",
    resume_hint: "PDF, DOC of DOCX (max 5 MB)",
    consent_label:
      "Ik geef toestemming om mijn gegevens te verwerken in lijn met het privacybeleid.",
    consent_link: "Lees het privacybeleid",
    submit: "Verstuur sollicitatie",
    submitting: "Bezig met verzenden…",
    cancel: "Annuleren",
    success_title: "Bedankt voor je sollicitatie!",
    success_body:
      "We hebben je sollicitatie ontvangen. Je hoort binnen 5 werkdagen van ons.",
    success_close: "Sluiten",
    error_generic:
      "Er ging iets mis bij het versturen. Probeer het opnieuw of neem contact met ons op.",
    error_required: "Dit veld is verplicht.",
    error_email: "Vul een geldig e-mailadres in.",
    error_phone: "Vul een geldig telefoonnummer in.",
    error_file_size: "Het bestand is te groot.",
    error_file_type: "Dit bestandstype wordt niet ondersteund.",
    powered_by: "powered by",
    privacy_policy: "Privacybeleid",
    page_not_found_title: "Pagina niet gevonden",
    page_not_found_body: "Deze career page bestaat niet of is niet meer actief.",
    page_unavailable_title: "Tijdelijk niet beschikbaar",
    page_unavailable_body:
      "We konden de career page niet laden. Probeer het later opnieuw.",
    footer_copyright: "© {year} {brand}. Alle rechten voorbehouden.",
    language_switcher_label: "Taal",
  },
  en: {
    apply_button: "Apply",
    view_jobs: "View open roles",
    open_positions: "Open positions",
    open_positions_count_one: "{n} open position",
    open_positions_count_other: "{n} open positions",
    no_jobs_title: "No open positions right now",
    no_jobs_subtitle: "Check back soon — we are growing fast.",
    back_to_overview: "Back to all jobs",
    job_details: "Role details",
    department: "Department",
    location: "Location",
    employment_type: "Employment",
    salary: "Salary",
    remote_friendly: "Remote-friendly",
    apply_now: "Apply now",
    application_form_title: "Submit your application",
    name_label: "Full name",
    email_label: "Email address",
    phone_label: "Phone number",
    cover_letter_label: "Cover letter",
    resume_label: "Upload your resume",
    resume_hint: "PDF, DOC or DOCX (max 5 MB)",
    consent_label:
      "I consent to my data being processed in line with the privacy policy.",
    consent_link: "Read the privacy policy",
    submit: "Submit application",
    submitting: "Submitting…",
    cancel: "Cancel",
    success_title: "Thanks for applying!",
    success_body:
      "We have received your application. You will hear from us within 5 business days.",
    success_close: "Close",
    error_generic:
      "Something went wrong while submitting. Please try again or contact us.",
    error_required: "This field is required.",
    error_email: "Please enter a valid email address.",
    error_phone: "Please enter a valid phone number.",
    error_file_size: "File is too large.",
    error_file_type: "This file type is not supported.",
    powered_by: "powered by",
    privacy_policy: "Privacy policy",
    page_not_found_title: "Page not found",
    page_not_found_body: "This career page does not exist or is no longer active.",
    page_unavailable_title: "Temporarily unavailable",
    page_unavailable_body:
      "We could not load this career page. Please try again later.",
    footer_copyright: "© {year} {brand}. All rights reserved.",
    language_switcher_label: "Language",
  },
};

/**
 * Look up a translated string. Replaces `{placeholder}` tokens with
 * stringified values from `vars`.
 */
export function t(
  locale: Locale,
  key: I18nKey,
  vars?: Record<string, string | number>
): string {
  const dict = STRINGS[locale] ?? STRINGS.nl;
  let value = dict[key] ?? STRINGS.nl[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

export function pluralCount(
  locale: Locale,
  n: number,
  oneKey: I18nKey,
  otherKey: I18nKey
): string {
  return t(locale, n === 1 ? oneKey : otherKey, { n });
}
