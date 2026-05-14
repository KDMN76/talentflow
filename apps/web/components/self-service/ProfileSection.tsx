/**
 * ProfileSection — read-only profielweergave + inline edit-mode.
 *
 * "Mijn profiel" sectie van het kandidaat-self-service-portaal.
 * Submit roept POST /correction aan via useUpdateSelfProfile.
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Pencil, User2, X, Check, Mail, Phone, Briefcase, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useUpdateSelfProfile, type SelfServiceCandidatePartial } from "@/hooks/useSelfService";
import type { SelfServiceCandidate } from "@/lib/mockData";

interface ProfileSectionProps {
  candidate: SelfServiceCandidate;
  token: string;
}

const FIELD_LABELS: Record<keyof SelfServiceCandidatePartial, string> = {
  first_name: "Voornaam",
  last_name: "Achternaam",
  email: "E-mailadres",
  phone: "Telefoonnummer",
  current_position: "Huidige functie",
  current_company: "Huidige werkgever",
};

export function ProfileSection({ candidate, token }: ProfileSectionProps) {
  const { toast } = useToast();
  const update = useUpdateSelfProfile(token);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SelfServiceCandidatePartial>(toForm(candidate));

  useEffect(() => {
    if (!editing) setForm(toForm(candidate));
  }, [candidate, editing]);

  const lastUpdate = formatNl(candidate.updated_at);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync(form);
      toast({
        title: "Wijzigingen opgeslagen",
        description: "Je profiel is bijgewerkt. Het recruitment-team is op de hoogte.",
      });
      setEditing(false);
    } catch {
      toast({
        title: "Niet gelukt",
        description: "Je wijzigingen konden niet worden opgeslagen. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  return (
    <SectionCard
      icon={<User2 className="h-4 w-4" />}
      title="Mijn profiel"
      description={`Laatste update: ${lastUpdate}`}
      action={
        !editing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            className="h-8 gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Wijzig
          </Button>
        ) : null
      }
    >
      {!editing ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <ReadField icon={<User2 className="h-3.5 w-3.5" />} label="Naam" value={fullName(candidate)} />
          <ReadField icon={<Mail className="h-3.5 w-3.5" />} label="E-mail" value={candidate.email} />
          <ReadField icon={<Phone className="h-3.5 w-3.5" />} label="Telefoon" value={candidate.phone} />
          <ReadField icon={<Briefcase className="h-3.5 w-3.5" />} label="Functie" value={candidate.current_position} />
          <ReadField
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Werkgever"
            value={candidate.current_company}
            className="sm:col-span-2"
          />
        </dl>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(Object.keys(FIELD_LABELS) as Array<keyof SelfServiceCandidatePartial>).map(
              (key) => (
                <div key={key} className={key === "current_company" ? "sm:col-span-2" : undefined}>
                  <Label htmlFor={`profile-${key}`} className="text-xs text-zinc-700 dark:text-zinc-300">
                    {FIELD_LABELS[key]}
                  </Label>
                  <Input
                    id={`profile-${key}`}
                    type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                    value={form[key] ?? ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: e.target.value || null }))
                    }
                    className="mt-1"
                    autoComplete="off"
                  />
                </div>
              )
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Je correctie wordt direct doorgevoerd en gelogd in onze WORM-audit-trail
            (AVG art. 16). De recruiter krijgt een melding.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={update.isPending} className="h-9 gap-1.5">
              {update.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Opslaan
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setForm(toForm(candidate));
              }}
              className="h-9 gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Annuleren
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}

function ReadField({
  icon,
  label,
  value,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
        {value && value.trim() !== "" ? value : <span className="text-zinc-400">— niet ingevuld —</span>}
      </dd>
    </div>
  );
}

function fullName(c: SelfServiceCandidate): string | null {
  const v = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return v || null;
}

function toForm(c: SelfServiceCandidate): SelfServiceCandidatePartial {
  return {
    first_name: c.first_name ?? "",
    last_name: c.last_name ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    current_position: c.current_position ?? "",
    current_company: c.current_company ?? "",
  };
}

function formatNl(iso: string): string {
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Internal layout component — gedeelde shell voor self-service-secties.
function SectionCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
                {icon}
              </span>
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
