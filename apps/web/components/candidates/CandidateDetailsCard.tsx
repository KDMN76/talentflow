"use client";

/**
 * CandidateDetailsCard — toont de rijke kandidaatgegevens die al in de
 * database staan (diploma, universiteit, geboortedatum, salaris, opzegtermijn,
 * talen, nationaliteiten, adres, AVG-consent) maar tot nu toe niet op het
 * profiel werden gerenderd. Bevat de "Bewerken"-knop die de bewerk-dialoog
 * opent.
 */

import { useState } from "react";
import type { Candidate } from "@talentflow/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil } from "lucide-react";
import { CandidateEditDialog } from "./CandidateEditDialog";

function age(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function fmtSalary(amount: number | null, currency: string | null): string | null {
  if (amount === null || amount === undefined) return null;
  try {
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount}`;
  }
}

interface Row {
  label: string;
  value: React.ReactNode;
}

export function CandidateDetailsCard({ candidate: c }: { candidate: Candidate }) {
  const [editOpen, setEditOpen] = useState(false);

  const birthAge = age(c.birthdate);
  const birth = fmtDate(c.birthdate);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Contact",
      rows: filterRows([
        { label: "E-mail", value: c.email },
        { label: "Telefoon", value: c.phone },
        { label: "Skype / overig", value: c.skype || c.other_contact },
        {
          label: "Adres",
          value:
            [c.address_line1, c.address_postal_code, c.address_city, c.address_country]
              .filter(Boolean)
              .join(", ") || null,
        },
      ]),
    },
    {
      title: "Persoonlijk",
      rows: filterRows([
        {
          label: "Geboortedatum",
          value: birth ? `${birth}${birthAge !== null ? ` (${birthAge} jaar)` : ""}` : null,
        },
        { label: "Nationaliteiten", value: chips(c.nationalities) },
        { label: "Talen", value: chips(c.languages) },
      ]),
    },
    {
      title: "Werk",
      rows: filterRows([
        { label: "Huidige functie", value: c.current_position },
        { label: "Huidig bedrijf", value: c.current_company },
        { label: "Branche", value: c.industry },
        {
          label: "Ervaring",
          value: c.years_of_experience !== null ? `${c.years_of_experience} jaar` : null,
        },
        { label: "Opzegtermijn", value: c.notice_period },
        { label: "Huidig salaris", value: fmtSalary(c.current_salary, c.current_salary_currency) },
        { label: "Verwacht salaris", value: fmtSalary(c.expected_salary, c.expected_salary_currency) },
      ]),
    },
    {
      title: "Opleiding",
      rows: filterRows([
        { label: "Diploma", value: c.diploma },
        { label: "Onderwijsinstelling", value: c.university },
        { label: "Afgestudeerd", value: fmtDate(c.graduation_date) },
      ]),
    },
    {
      title: "AVG & toestemming",
      rows: filterRows([
        {
          label: "AVG-toestemming",
          value: c.gdpr_consent
            ? `Gegeven${fmtDate(c.gdpr_consent_at) ? ` · ${fmtDate(c.gdpr_consent_at)}` : ""}`
            : "Niet gegeven",
        },
        {
          label: "E-mailtoestemming",
          value: c.email_consent ? "Gegeven" : "Niet gegeven",
        },
      ]),
    },
  ].filter((g) => g.rows.length > 0);

  const isEmpty = groups.every((g) => g.rows.length === 0);

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Kandidaatgegevens</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Bewerken
          </Button>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <p className="text-sm text-muted-foreground">
              Nog geen aanvullende gegevens. Upload een cv om ze automatisch te laten
              invullen, of klik op Bewerken.
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.title}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.title}
                  </h4>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {g.rows.map((r) => (
                      <div key={r.label} className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">{r.label}</dt>
                        <dd className="text-sm text-zinc-800 dark:text-zinc-200 break-words">
                          {r.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CandidateEditDialog candidate={c} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}

function filterRows(rows: Row[]): Row[] {
  return rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== "");
}

function chips(values: string[] | null): React.ReactNode {
  if (!values || values.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((v) => (
        <Badge key={v} variant="secondary" className="text-xs font-normal">
          {v}
        </Badge>
      ))}
    </span>
  );
}
