"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  MapPin,
  Briefcase,
  Building2,
  Banknote,
  CheckCircle2,
  Upload,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  usePublicCareerPage,
  useSubmitApplication,
  type PublicCareerPageJob,
  type CareerPageTemplate,
} from "@/hooks/useCareerPages";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSalary(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `Vanaf ${fmt(min)}`;
  if (max) return `Tot ${fmt(max)}`;
  return null;
}

function employmentTypeLabel(t: string | null): string | null {
  if (!t) return null;
  const map: Record<string, string> = {
    fulltime: "Fulltime",
    parttime: "Parttime",
    contract: "Contract",
    temporary: "Tijdelijk",
    internship: "Stage",
  };
  return map[t.toLowerCase()] ?? t;
}

// ─── Hero variants ────────────────────────────────────────────────────────────

function HeroSection({
  template,
  primaryColor,
  fontFamily,
  headerText,
  introText,
  companyName,
  logoUrl,
}: {
  template: CareerPageTemplate;
  primaryColor: string;
  fontFamily: string;
  headerText: string;
  introText: string;
  companyName: string;
  logoUrl?: string;
}) {
  const styles: Record<CareerPageTemplate, React.CSSProperties> = {
    modern: {
      background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`,
      color: "#fff",
    },
    classic: {
      background: "#f8fafc",
      color: "#0f172a",
      borderTop: `8px solid ${primaryColor}`,
    },
    minimal: {
      background: "#ffffff",
      color: "#0f172a",
    },
    tech: {
      background: `linear-gradient(135deg, #0f172a, ${primaryColor}33 60%, #0f172a)`,
      color: "#fff",
    },
    creative: {
      background: `radial-gradient(circle at 20% 20%, ${primaryColor}, transparent 50%), radial-gradient(circle at 80% 80%, ${primaryColor}cc, white 70%)`,
      color: "#0f172a",
    },
    agency: {
      background: `linear-gradient(180deg, #ffffff 0%, ${primaryColor}11 100%)`,
      color: "#0f172a",
      borderBottom: `4px solid ${primaryColor}`,
    },
  };

  return (
    <section className="relative overflow-hidden" style={{ ...styles[template], fontFamily }}>
      {template === "modern" && (
        <>
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10" />
          <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-white/5" />
        </>
      )}
      {template === "tech" && (
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
      )}

      <div className="relative max-w-5xl mx-auto px-6 py-20 md:py-28">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={`${companyName} logo`}
            className="mb-6 h-12 w-auto rounded"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className={`mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              template === "modern" || template === "tech"
                ? "bg-white/20 text-white backdrop-blur"
                : "bg-zinc-900/5 text-zinc-700"
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            {companyName}
          </div>
        )}

        {template === "tech" && (
          <p className="mb-3 font-mono text-sm text-emerald-400">
            $ careers --hire
          </p>
        )}

        <h1
          className={`font-bold tracking-tight ${
            template === "classic" ? "font-serif text-4xl md:text-5xl" : "text-4xl md:text-6xl"
          }`}
          style={template === "classic" ? { color: primaryColor } : undefined}
        >
          {headerText}
        </h1>

        {template === "minimal" && (
          <div
            className="mt-6 h-1.5 w-16 rounded-full"
            style={{ backgroundColor: primaryColor }}
          />
        )}

        <p
          className={`mt-6 max-w-2xl text-lg leading-relaxed ${
            template === "modern" || template === "tech"
              ? "text-white/90"
              : "text-zinc-600"
          }`}
        >
          {introText}
        </p>

        <a
          href="#vacatures"
          className={`mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:scale-105 ${
            template === "modern" || template === "tech"
              ? "bg-white text-zinc-900 shadow-lg"
              : "text-white shadow-lg"
          }`}
          style={
            template !== "modern" && template !== "tech"
              ? { backgroundColor: primaryColor }
              : undefined
          }
        >
          Bekijk vacatures
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}

// ─── Application Form ────────────────────────────────────────────────────────

function ApplicationDialog({
  job,
  open,
  onClose,
  primaryColor,
  fontFamily,
  slug,
}: {
  job: PublicCareerPageJob | null;
  open: boolean;
  onClose: () => void;
  primaryColor: string;
  fontFamily: string;
  slug: string;
}) {
  const submit = useSubmitApplication(slug);
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPhone("");
      setCoverLetter("");
      setResumeName(null);
      setSubmitted(false);
    }
  }, [open]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setResumeName(file.name);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!job) return;

    if (!name.trim() || !email.trim()) {
      toast({
        title: "Velden ontbreken",
        description: "Vul je naam en e-mailadres in.",
        variant: "destructive",
      });
      return;
    }

    try {
      await submit.mutateAsync({
        job_id: job.id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        cover_letter: coverLetter.trim() || undefined,
        resume_filename: resumeName ?? undefined,
      });
      setSubmitted(true);
    } catch {
      toast({
        title: "Fout",
        description: "Sollicitatie kon niet worden verzonden. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto"
        style={{ fontFamily }}
      >
        {submitted ? (
          <div className="py-8 text-center">
            <div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full animate-in zoom-in duration-500"
              style={{ backgroundColor: `${primaryColor}20` }}
            >
              <CheckCircle2
                className="h-12 w-12 animate-in zoom-in duration-700"
                style={{ color: primaryColor }}
              />
            </div>
            <h2 className="mt-5 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              Bedankt voor je sollicitatie!
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We hebben je sollicitatie ontvangen voor{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {job?.title}
              </span>
              . We nemen binnen enkele werkdagen contact met je op.
            </p>
            <Button
              onClick={onClose}
              className="mt-6 text-white border-0"
              style={{ backgroundColor: primaryColor }}
            >
              Sluiten
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">
                Solliciteren: {job?.title}
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Vul je gegevens in. We nemen zo snel mogelijk contact op.
              </p>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="ap-name">
                  Naam <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ap-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Voornaam Achternaam"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ap-email">
                    E-mail <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="ap-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jij@voorbeeld.nl"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ap-phone">
                    Telefoon{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      (optioneel)
                    </span>
                  </Label>
                  <Input
                    id="ap-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+31 6 12345678"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ap-letter">Motivatiebrief</Label>
                <textarea
                  id="ap-letter"
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  placeholder="Vertel ons waarom je perfect bij deze rol past…"
                  className="w-full min-h-[120px] rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ap-cv">CV</Label>
                <label
                  htmlFor="ap-cv"
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input bg-background px-4 py-3 hover:border-zinc-400 transition-colors"
                >
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${primaryColor}15`,
                      color: primaryColor,
                    }}
                  >
                    <Upload className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {resumeName ? (
                      <>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {resumeName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Klik om te vervangen
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          Upload je CV
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PDF, DOC of DOCX (max 5 MB)
                        </p>
                      </>
                    )}
                  </div>
                </label>
                <input
                  id="ap-cv"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="sr-only"
                  onChange={handleFile}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Annuleren
                </Button>
                <Button
                  type="submit"
                  disabled={submit.isPending}
                  className="text-white border-0 gap-2"
                  style={{ backgroundColor: primaryColor }}
                >
                  {submit.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verzenden…
                    </>
                  ) : (
                    "Solliciteren"
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PublicCareerPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const { data, isLoading, isError } = usePublicCareerPage(slug);
  const [activeJob, setActiveJob] = useState<PublicCareerPageJob | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40 mb-4">
          <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Pagina niet gevonden
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Deze career page bestaat niet of is niet meer actief.
        </p>
      </div>
    );
  }

  const { career_page, jobs, company_name } = data;
  const cfg = career_page.config;
  const primaryColor = cfg.primary_color ?? "#6366f1";
  const fontFamily = cfg.font_family ?? "Inter";
  const headerText = cfg.header_text || `Werk bij ${company_name}`;
  const introText =
    cfg.intro_text ||
    "Ontdek vacatures die bij je passen en solliciteer in één klik.";

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily }}>
      <HeroSection
        template={career_page.template}
        primaryColor={primaryColor}
        fontFamily={fontFamily}
        headerText={headerText}
        introText={introText}
        companyName={company_name}
        logoUrl={cfg.logo_url}
      />

      {/* Jobs */}
      <section
        id="vacatures"
        className="flex-1 max-w-5xl mx-auto w-full px-6 py-16"
      >
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              Open vacatures
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {jobs.length} {jobs.length === 1 ? "openstaande positie" : "openstaande posities"}
            </p>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Op dit moment geen vacatures
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Kom later terug — we groeien snel.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const salary = formatSalary(job.salary_min, job.salary_max);
              const empType = employmentTypeLabel(job.employment_type);
              return (
                <div
                  key={job.id}
                  className="group flex flex-col gap-4 rounded-xl border bg-white dark:bg-zinc-950 p-5 shadow-sm hover:shadow-md transition-all md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {job.title}
                      </h3>
                      {empType && (
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            backgroundColor: `${primaryColor}15`,
                            color: primaryColor,
                          }}
                        >
                          {empType}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {job.department && (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5" />
                          {job.department}
                        </div>
                      )}
                      {job.location && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {job.location}
                        </div>
                      )}
                      {salary && (
                        <div className="flex items-center gap-1.5">
                          <Banknote className="h-3.5 w-3.5" />
                          {salary}
                        </div>
                      )}
                    </div>

                    <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                      {job.description}
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveJob(job)}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-105"
                    style={{ backgroundColor: primaryColor }}
                  >
                    Solliciteer
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t bg-zinc-50 dark:bg-zinc-900/50 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} {company_name}. Alle rechten voorbehouden.
          </p>
          <p className="text-xs text-muted-foreground">
            Career page powered by{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              TalentFlow
            </span>
          </p>
        </div>
      </footer>

      <ApplicationDialog
        job={activeJob}
        open={!!activeJob}
        onClose={() => setActiveJob(null)}
        primaryColor={primaryColor}
        fontFamily={fontFamily}
        slug={slug}
      />
    </div>
  );
}
