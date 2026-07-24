"use client";

/**
 * CandidateEditDialog — bewerk de kerngegevens van een kandidaat.
 *
 * De backend (PATCH /candidates/:id → updateCandidate) accepteert al elk veld
 * hieronder; tot nu toe ontbrak alleen een bewerk-UI op het profiel, waardoor
 * een simpele wijziging ("kandidaat belt dat zijn nummer is veranderd")
 * onmogelijk was. We sturen alléén de gewijzigde velden mee (diff), zodat we
 * niets onbedoeld overschrijven.
 */

import { useEffect, useMemo, useState } from "react";
import type { Candidate, UpdateCandidateInput } from "@talentflow/shared";
import { useUpdateCandidate } from "@/hooks/useCandidates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  candidate: Candidate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Velden die de vorm beheert. Alle overige kandidaatvelden blijven ongemoeid. */
type FormState = {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  current_position: string;
  current_company: string;
  industry: string;
  years_of_experience: string; // number-input als string
  notice_period: string;
  current_salary: string;
  expected_salary: string;
  diploma: string;
  university: string;
  address_city: string;
  address_country: string;
  address_postal_code: string;
  birthdate: string; // yyyy-mm-dd
  skype: string;
  description: string;
};

const TEXT_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "current_position",
  "current_company",
  "industry",
  "notice_period",
  "diploma",
  "university",
  "address_city",
  "address_country",
  "address_postal_code",
  "skype",
  "description",
] as const;

const NUMBER_FIELDS = [
  "years_of_experience",
  "current_salary",
  "expected_salary",
] as const;

function toForm(c: Candidate): FormState {
  const s = (v: string | null | undefined) => v ?? "";
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    name: s(c.name),
    first_name: s(c.first_name),
    last_name: s(c.last_name),
    email: s(c.email),
    phone: s(c.phone),
    current_position: s(c.current_position),
    current_company: s(c.current_company),
    industry: s(c.industry),
    years_of_experience: n(c.years_of_experience),
    notice_period: s(c.notice_period),
    current_salary: n(c.current_salary),
    expected_salary: n(c.expected_salary),
    diploma: s(c.diploma),
    university: s(c.university),
    address_city: s(c.address_city),
    address_country: s(c.address_country),
    address_postal_code: s(c.address_postal_code),
    birthdate: c.birthdate ? c.birthdate.slice(0, 10) : "",
    skype: s(c.skype),
    description: s(c.description),
  };
}

export function CandidateEditDialog({ candidate, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const update = useUpdateCandidate();
  const initial = useMemo(() => toForm(candidate), [candidate]);
  const [form, setForm] = useState<FormState>(initial);

  // Reset de vorm zodra een andere kandidaat wordt geopend of de dialog opent.
  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const set = (k: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [k]: value }));

  function buildPatch(): UpdateCandidateInput {
    const patch: UpdateCandidateInput = {};

    for (const key of TEXT_FIELDS) {
      const next = form[key].trim();
      const prev = (initial[key] ?? "").trim();
      if (next !== prev) {
        // Lege string wist het veld (kolom is nullable in de DB).
        (patch as Record<string, unknown>)[key] = next === "" ? null : next;
      }
    }

    for (const key of NUMBER_FIELDS) {
      const next = form[key].trim();
      const prev = (initial[key] ?? "").trim();
      if (next !== prev) {
        (patch as Record<string, unknown>)[key] =
          next === "" ? null : Number(next);
      }
    }

    if (form.birthdate !== initial.birthdate) {
      patch.birthdate = form.birthdate === "" ? null : form.birthdate;
    }

    return patch;
  }

  async function handleSave() {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    // Lichte validatie: e-mail moet een @ bevatten als hij is ingevuld.
    if (typeof patch.email === "string" && patch.email && !patch.email.includes("@")) {
      toast({
        title: "Ongeldig e-mailadres",
        description: "Vul een geldig e-mailadres in of laat het veld leeg.",
        variant: "destructive",
      });
      return;
    }
    try {
      await update.mutateAsync({ id: candidate.id, ...patch });
      toast({ title: "Kandidaat bijgewerkt" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Bijwerken mislukt",
        description: (err as Error)?.message ?? "Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kandidaat bewerken</DialogTitle>
          <DialogDescription>
            Werk de gegevens van {candidate.name || "deze kandidaat"} bij. Alleen
            gewijzigde velden worden opgeslagen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <Section title="Naam & contact">
            <Field label="Volledige naam" id="name">
              <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Voornaam" id="first_name">
                <Input id="first_name" value={form.first_name} onChange={(e) => set("first_name")(e.target.value)} />
              </Field>
              <Field label="Achternaam" id="last_name">
                <Input id="last_name" value={form.last_name} onChange={(e) => set("last_name")(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="E-mailadres" id="email">
                <Input id="email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} placeholder="naam@bedrijf.nl" />
              </Field>
              <Field label="Telefoonnummer" id="phone">
                <Input id="phone" value={form.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+31 6 …" />
              </Field>
            </div>
          </Section>

          <Section title="Werk">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Huidige functie" id="current_position">
                <Input id="current_position" value={form.current_position} onChange={(e) => set("current_position")(e.target.value)} />
              </Field>
              <Field label="Huidig bedrijf" id="current_company">
                <Input id="current_company" value={form.current_company} onChange={(e) => set("current_company")(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Branche" id="industry">
                <Input id="industry" value={form.industry} onChange={(e) => set("industry")(e.target.value)} />
              </Field>
              <Field label="Jaren ervaring" id="years_of_experience">
                <Input id="years_of_experience" type="number" min="0" value={form.years_of_experience} onChange={(e) => set("years_of_experience")(e.target.value)} />
              </Field>
              <Field label="Opzegtermijn" id="notice_period">
                <Input id="notice_period" value={form.notice_period} onChange={(e) => set("notice_period")(e.target.value)} placeholder="bijv. 1 maand" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Huidig salaris (€)" id="current_salary">
                <Input id="current_salary" type="number" min="0" value={form.current_salary} onChange={(e) => set("current_salary")(e.target.value)} />
              </Field>
              <Field label="Verwacht salaris (€)" id="expected_salary">
                <Input id="expected_salary" type="number" min="0" value={form.expected_salary} onChange={(e) => set("expected_salary")(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Opleiding & persoonlijk">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Diploma / opleiding" id="diploma">
                <Input id="diploma" value={form.diploma} onChange={(e) => set("diploma")(e.target.value)} />
              </Field>
              <Field label="Onderwijsinstelling" id="university">
                <Input id="university" value={form.university} onChange={(e) => set("university")(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Geboortedatum" id="birthdate">
                <Input id="birthdate" type="date" value={form.birthdate} onChange={(e) => set("birthdate")(e.target.value)} />
              </Field>
              <Field label="Skype / overig" id="skype">
                <Input id="skype" value={form.skype} onChange={(e) => set("skype")(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Adres">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Plaats" id="address_city">
                <Input id="address_city" value={form.address_city} onChange={(e) => set("address_city")(e.target.value)} />
              </Field>
              <Field label="Land" id="address_country">
                <Input id="address_country" value={form.address_country} onChange={(e) => set("address_country")(e.target.value)} />
              </Field>
              <Field label="Postcode" id="address_postal_code">
                <Input id="address_postal_code" value={form.address_postal_code} onChange={(e) => set("address_postal_code")(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Omschrijving">
            <Field label="Notitie / samenvatting" id="description">
              <Textarea id="description" rows={3} value={form.description} onChange={(e) => set("description")(e.target.value)} />
            </Field>
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Annuleren
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Opslaan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}
