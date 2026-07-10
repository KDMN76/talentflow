"use client";

import { useEffect, useState } from "react";
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
  Sparkles,
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
  type CareerPageBlock,
  type JobsListBlockConfig,
} from "@/hooks/useCareerPages";
import { resolveCareerBlocks } from "./careerBlocks";
import { builderBlockToPublicBlock } from "@/components/career-builder/configToData";
import { sanitizeColor } from "@/components/career-public/utils";
import type {
  PublicBranding,
  PublicJob,
  Locale,
} from "@/components/career-public/types";
import { PublicHeroBlock } from "@/components/career-public/blocks/PublicHeroBlock";
import { PublicFeaturesBlock } from "@/components/career-public/blocks/PublicFeaturesBlock";
import { PublicAboutBlock } from "@/components/career-public/blocks/PublicAboutBlock";
import { PublicTestimonialsBlock } from "@/components/career-public/blocks/PublicTestimonialsBlock";
import { PublicCtaBlock } from "@/components/career-public/blocks/PublicCtaBlock";
import { PublicFooterBlock } from "@/components/career-public/blocks/PublicFooterBlock";
import { PublicCustomHtmlBlock } from "@/components/career-public/blocks/PublicCustomHtmlBlock";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// EU 2023/970 art. 5: kandidaten moeten de band én de periode kunnen
// interpreteren — de frequentie hoort dus bij de salarisweergave.
const FREQUENCY_SUFFIX: Record<string, string> = {
  monthly: "per maand",
  annual: "per jaar",
  hourly: "per uur",
};

function formatSalary(
  min: number | null,
  max: number | null,
  frequency: string | null
): string | null {
  if (!min && !max) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n);
  const suffix = frequency ? FREQUENCY_SUFFIX[frequency] ?? "" : "";
  const withSuffix = (s: string) => (suffix ? `${s} ${suffix}` : s);
  if (min && max) return withSuffix(`${fmt(min)} – ${fmt(max)}`);
  if (min) return withSuffix(`Vanaf ${fmt(min)}`);
  if (max) return withSuffix(`Tot ${fmt(max)}`);
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

// ─── Job card + jobs section ──────────────────────────────────────────────────
// Gedeeld tussen de vaste template (fallback) en het jobs_list-blok, zodat de
// pay-transparency-weergave (band + frequentie + beloningscriteria) op één plek
// staat en overal identiek is.

function JobCard({
  job,
  primaryColor,
  onApply,
}: {
  job: PublicCareerPageJob;
  primaryColor: string;
  onApply: (job: PublicCareerPageJob) => void;
}) {
  const salary = formatSalary(
    job.salary_min,
    job.salary_max,
    job.salary_frequency
  );
  const empType = employmentTypeLabel(job.employment_type);
  return (
    <div className="group flex flex-col gap-4 rounded-xl border bg-white dark:bg-zinc-950 p-5 shadow-sm hover:shadow-md transition-all md:flex-row md:items-center md:justify-between">
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

        {/* Beloningscriteria (EU 2023/970 art. 5) — hoe de
            beloning wordt bepaald, publiek zichtbaar. */}
        {job.compensation_criteria && (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed line-clamp-2">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              Beloningscriteria:
            </span>{" "}
            {job.compensation_criteria}
          </p>
        )}
      </div>

      <button
        onClick={() => onApply(job)}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-105"
        style={{ backgroundColor: primaryColor }}
      >
        Solliciteer
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function JobsSection({
  jobs,
  primaryColor,
  onApply,
  grow = false,
  id = "vacatures",
}: {
  jobs: PublicCareerPageJob[];
  primaryColor: string;
  onApply: (job: PublicCareerPageJob) => void;
  grow?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`max-w-5xl mx-auto w-full px-6 py-16 ${grow ? "flex-1" : ""}`}
    >
      {/* Extra anker: builder-hero/cta-blokken linken standaard naar #jobs. */}
      <span id="jobs" aria-hidden className="block h-0 scroll-mt-16" />
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
            Open vacatures
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobs.length}{" "}
            {jobs.length === 1 ? "openstaande positie" : "openstaande posities"}
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
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              primaryColor={primaryColor}
              onApply={onApply}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Block renderer ───────────────────────────────────────────────────────────
// Rendert builder-blocks blok-voor-blok. Presentatie-blokken (hero, features,
// about, testimonials, cta, footer, custom_html) hergebruiken exact dezelfde
// publieke renderers als de builder-preview → WYSIWYG-pariteit. Het jobs_list-
// blok gebruikt de eigen JobsSection zodat band + beloningscriteria zichtbaar
// blijven en de solliciteer-knop de disclosure-dialog opent.

function CareerBlockRenderer({
  block,
  jobs,
  branding,
  locale,
  slug,
  careerPageId,
  primaryColor,
  onApply,
}: {
  block: CareerPageBlock;
  jobs: PublicCareerPageJob[];
  branding: PublicBranding;
  locale: Locale;
  slug: string;
  careerPageId: string;
  primaryColor: string;
  onApply: (job: PublicCareerPageJob) => void;
}) {
  if (block.type === "jobs_list") {
    const cfg = block.config as JobsListBlockConfig;
    let list = jobs.slice();
    const dept = cfg.filter?.department?.trim().toLowerCase();
    if (dept) {
      list = list.filter((j) => (j.department ?? "").toLowerCase() === dept);
    }
    if (cfg.limit && cfg.limit > 0) {
      list = list.slice(0, cfg.limit);
    }
    return (
      <JobsSection jobs={list} primaryColor={primaryColor} onApply={onApply} />
    );
  }

  // Presentatie-blokken: adapteer builder-config → publieke `data` en render
  // de bestaande publieke renderer. Deze gebruiken geen `jobs`.
  const publicBlock = builderBlockToPublicBlock(block);
  const props = {
    block: publicBlock,
    jobs: [] as PublicJob[],
    branding,
    locale,
    slug,
    careerPageId,
  };
  switch (block.type) {
    case "hero":
      return <PublicHeroBlock {...props} />;
    case "features":
      return <PublicFeaturesBlock {...props} />;
    case "about":
      return <PublicAboutBlock {...props} />;
    case "testimonials":
      return <PublicTestimonialsBlock {...props} />;
    case "cta":
      return <PublicCtaBlock {...props} />;
    case "footer":
      return <PublicFooterBlock {...props} />;
    case "custom_html":
      return <PublicCustomHtmlBlock {...props} />;
    default:
      return null;
  }
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

              {/* EU AI Act art. 13 — transparantie richting kandidaat: AI
                  ondersteunt de behandeling van sollicitaties, een mens
                  neemt het besluit. Publieke pagina is NL (net als de rest
                  van deze pagina). */}
              <div className="flex items-start gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-border px-3 py-2.5">
                <Sparkles
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: primaryColor }}
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Bij de behandeling van je sollicitatie wordt AI gebruikt ter
                  ondersteuning (zoals CV-verwerking en het matchen met
                  vacatures). Beslissingen over je sollicitatie worden altijd
                  door een mens genomen en gecontroleerd. (EU AI Act art. 13)
                </p>
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

// ─── Career page view ─────────────────────────────────────────────────────────
// De volledige publieke career-page, met de slug als PROP (niet via useParams).
// Zo kan dezelfde render worden gebruikt door:
//   1. de directe route  app/careers/[slug]/page.tsx  (slug uit useParams), en
//   2. de white-label host-gate in de root-layout, die de slug uit de door de
//      middleware gezette header haalt — zodat op een custom domein de browser-
//      URL "/" blijft ZONDER dat de client-router de app-root (dashboard/
//      auth-guard) monteert. Beide paden delen exact deze component.

export function CareerPageView({ slug }: { slug: string }) {
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

  // Builder-blocks (config.blocks) → render blok-voor-blok. Zonder bruikbare
  // blocks valt de pagina terug op de vaste template.
  const blocks = resolveCareerBlocks(cfg);

  const branding: PublicBranding = {
    brand_name: company_name,
    logo_url: cfg.logo_url ?? null,
    primary_color: primaryColor,
    accent_color: null,
    font_family: fontFamily,
  };
  const locale: Locale = career_page.language === "en" ? "en" : "nl";

  // De publieke block-renderers stylen via `--brand-primary`; zet die var op
  // een wrapper zodat ze de tenant-kleur oppikken (dezelfde bron als de
  // builder-preview, die de var via een <style>-tag zet).
  const brandStyle: React.CSSProperties & Record<`--${string}`, string> = {
    fontFamily,
    "--brand-primary": sanitizeColor(primaryColor) ?? "#6366f1",
    "--brand-accent": sanitizeColor(primaryColor) ?? "#6366f1",
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily }}>
      {blocks ? (
        <div className="flex flex-1 flex-col" style={brandStyle}>
          {blocks.map((block) => (
            <CareerBlockRenderer
              key={block.id}
              block={block}
              jobs={jobs}
              branding={branding}
              locale={locale}
              slug={slug}
              careerPageId={career_page.id}
              primaryColor={primaryColor}
              onApply={setActiveJob}
            />
          ))}
        </div>
      ) : (
        <>
          <HeroSection
            template={career_page.template}
            primaryColor={primaryColor}
            fontFamily={fontFamily}
            headerText={headerText}
            introText={introText}
            companyName={company_name}
            logoUrl={cfg.logo_url}
          />

          <JobsSection
            jobs={jobs}
            primaryColor={primaryColor}
            onApply={setActiveJob}
            grow
          />

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
        </>
      )}

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
