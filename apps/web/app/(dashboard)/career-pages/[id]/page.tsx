"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Save,
  ExternalLink,
  Globe,
  Eye,
  FileText,
  AlertCircle,
  LayoutTemplate,
  ShieldCheck,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useCareerPage,
  useUpdateCareerPage,
  useSetCustomDomain,
  useVerifyCustomDomain,
  TEMPLATE_LABELS,
  LANGUAGE_LABELS,
  LANGUAGE_FLAGS,
  type CareerPageConfig,
  type CareerPageTemplate,
  type CareerPageLanguage,
} from "@/hooks/useCareerPages";

// A-record-doel: het VPS-IP waar klant-domeinen naartoe moeten wijzen.
const DNS_TARGET_IP = "91.98.232.104";

const TEMPLATES: CareerPageTemplate[] = [
  "modern",
  "classic",
  "minimal",
  "tech",
  "creative",
];
const LANGUAGES: CareerPageLanguage[] = ["nl", "en", "de", "fr", "es"];

const FONT_OPTIONS = [
  { value: "Inter", label: "Inter (modern sans)" },
  { value: "Roboto", label: "Roboto" },
  { value: "Poppins", label: "Poppins" },
  { value: "Merriweather", label: "Merriweather (serif)" },
  { value: "Playfair Display", label: "Playfair Display (serif)" },
  { value: "JetBrains Mono", label: "JetBrains Mono (mono)" },
];

// ─── Live Preview ────────────────────────────────────────────────────────────

function LivePreview({
  config,
  template,
}: {
  config: CareerPageConfig;
  template: CareerPageTemplate;
}) {
  const { t } = useTranslation("careerPages");
  const primary = config.primary_color ?? "#6366f1";
  const fontFamily = config.font_family ?? "Inter";
  const header = config.header_text || t("editor.preview.defaultHeader");
  const intro =
    config.intro_text ||
    t("editor.preview.defaultIntro");

  const heroStyles: Record<CareerPageTemplate, React.CSSProperties> = {
    modern: {
      background: `linear-gradient(135deg, ${primary}, ${primary}cc)`,
      color: "#fff",
    },
    classic: {
      background: "#f8fafc",
      color: "#0f172a",
      borderTop: `6px solid ${primary}`,
    },
    minimal: {
      background: "#ffffff",
      color: "#0f172a",
    },
    tech: {
      background: `linear-gradient(135deg, #0f172a, ${primary}33 60%, #0f172a)`,
      color: "#fff",
    },
    creative: {
      background: `radial-gradient(circle at 20% 20%, ${primary}, transparent 50%), radial-gradient(circle at 80% 80%, ${primary}cc, white 70%)`,
      color: "#0f172a",
    },
    agency: {
      background: `linear-gradient(180deg, #ffffff, ${primary}14)`,
      color: "#0f172a",
      borderLeft: `4px solid ${primary}`,
    },
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-white dark:bg-zinc-950 shadow-sm">
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 border-b bg-zinc-50 dark:bg-zinc-900 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 text-xs text-muted-foreground font-mono truncate">
          /careers/preview
        </span>
      </div>

      {/* Hero */}
      <div
        className="relative px-6 py-10"
        style={{ ...heroStyles[template], fontFamily }}
      >
        {template === "modern" && (
          <>
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/15" />
            <div className="absolute -bottom-6 -left-6 h-20 w-20 rounded-full bg-white/10" />
          </>
        )}
        {template === "tech" && (
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          />
        )}
        <div className="relative">
          {config.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={config.logo_url}
              alt="Logo"
              className="mb-4 h-10 w-auto rounded"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          {template === "tech" && (
            <p className="font-mono text-xs text-emerald-400 mb-2">
              {t("editor.preview.techPrompt")}
            </p>
          )}
          <h1
            className={`font-bold leading-tight ${
              template === "classic" ? "font-serif text-2xl" : "text-2xl"
            }`}
            style={template === "classic" ? { color: primary } : undefined}
          >
            {header}
          </h1>
          <p
            className={`mt-2 text-sm leading-relaxed ${
              template === "modern" || template === "tech"
                ? "text-white/90"
                : "text-zinc-600"
            }`}
          >
            {intro}
          </p>
          {template === "minimal" && (
            <div
              className="mt-4 h-1 w-12 rounded-full"
              style={{ backgroundColor: primary }}
            />
          )}
        </div>
      </div>

      {/* Sample jobs */}
      <div className="space-y-2 p-4 bg-zinc-50/50 dark:bg-zinc-900/50">
        {[
          {
            title: t("editor.preview.sampleJob1Title"),
            loc: t("editor.preview.sampleJob1Location"),
            type: t("editor.preview.sampleJobType"),
          },
          {
            title: t("editor.preview.sampleJob2Title"),
            loc: t("editor.preview.sampleJob2Location"),
            type: t("editor.preview.sampleJobType"),
          },
        ].map((job) => (
          <div
            key={job.title}
            className="flex items-center justify-between rounded-lg border bg-white dark:bg-zinc-950 p-3"
            style={{ fontFamily }}
          >
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {job.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {job.loc} · {job.type}
              </p>
            </div>
            <button
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
              style={{ backgroundColor: primary }}
            >
              {t("editor.preview.apply")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CareerPageEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const { toast } = useToast();
  const { data: page, isLoading, isError } = useCareerPage(id);
  const updatePage = useUpdateCareerPage();
  const setDomain = useSetCustomDomain(id);
  const verifyDomain = useVerifyCustomDomain(id);
  const { t } = useTranslation("careerPages");

  // Local editable state
  const [headerText, setHeaderText] = useState("");
  const [introText, setIntroText] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");
  const [logoUrl, setLogoUrl] = useState("");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [template, setTemplate] = useState<CareerPageTemplate>("modern");
  const [language, setLanguage] = useState<CareerPageLanguage>("nl");
  const [customDomain, setCustomDomain] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (page && !hydrated) {
      setHeaderText(page.config.header_text ?? "");
      setIntroText(page.config.intro_text ?? "");
      setPrimaryColor(page.config.primary_color ?? "#6366f1");
      setLogoUrl(page.config.logo_url ?? "");
      setFontFamily(page.config.font_family ?? "Inter");
      setTemplate(page.template);
      setLanguage(page.language);
      setCustomDomain(page.custom_domain ?? "");
      setHydrated(true);
    }
  }, [page, hydrated]);

  const handleSave = async () => {
    if (!page) return;
    // NB: het eigen domein wordt NIET via deze algemene Save opgeslagen, maar
    // via de dedicated "Eigen domein"-sectie (PUT /custom-domain) — die valideert
    // de hostnaam, dwingt uniciteit af en beheert de verificatiestatus.
    try {
      await updatePage.mutateAsync({
        id: page.id,
        template,
        language,
        config: {
          header_text: headerText,
          intro_text: introText,
          primary_color: primaryColor,
          logo_url: logoUrl,
          font_family: fontFamily,
        },
      });
      toast({
        title: t("editor.toasts.saved.title"),
        description: t("editor.toasts.saved.description", { slug: page.slug }),
      });
    } catch {
      toast({
        title: t("editor.toasts.saveError.title"),
        description: t("editor.toasts.saveError.description"),
        variant: "destructive",
      });
    }
  };

  const handleSaveDomain = async () => {
    if (!page) return;
    const value = customDomain.trim() || null;
    try {
      await setDomain.mutateAsync(value);
      toast(
        value
          ? {
              title: t("editor.domain.toasts.saved.title"),
              description: t("editor.domain.toasts.saved.description", {
                domain: value,
              }),
            }
          : {
              title: t("editor.domain.toasts.cleared.title"),
              description: t("editor.domain.toasts.cleared.description"),
            }
      );
    } catch (err) {
      const apiMsg = (
        err as { response?: { data?: { error?: { message?: string } } } }
      )?.response?.data?.error?.message;
      toast({
        title: t("editor.domain.toasts.saveError.title"),
        description: apiMsg ?? t("editor.domain.toasts.saveError.description"),
        variant: "destructive",
      });
    }
  };

  const handleVerifyDomain = async () => {
    try {
      const result = await verifyDomain.mutateAsync();
      if (result.verified) {
        toast({
          title: t("editor.domain.toasts.verified.title"),
          description: t("editor.domain.toasts.verified.description", {
            domain: result.custom_domain,
          }),
        });
      } else {
        toast({
          title: t("editor.domain.toasts.verifyFailed.title"),
          description:
            result.reason ??
            t("editor.domain.toasts.verifyFailed.description"),
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: t("editor.domain.toasts.verifyFailed.title"),
        description: t("editor.domain.toasts.verifyFailed.description"),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[600px] rounded-xl" />
          <Skeleton className="h-[600px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40 mb-3">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
        </div>
        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t("editor.notFound.title")}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/career-pages")}>
          {t("editor.notFound.back")}
        </Button>
      </div>
    );
  }

  const liveConfig: CareerPageConfig = {
    header_text: headerText,
    intro_text: introText,
    primary_color: primaryColor,
    logo_url: logoUrl,
    font_family: fontFamily,
  };

  // Domein-status: verificatie geldt alleen voor het opgeslagen domein. Zodra
  // het invoerveld afwijkt (nog niet opgeslagen) tonen we geen "geverifieerd".
  const savedDomain = page.custom_domain ?? "";
  const domainDirty = customDomain.trim() !== savedDomain;
  const domainVerified =
    !!page.custom_domain_verified_at && !domainDirty && !!savedDomain;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Link href="/career-pages">
              <ArrowLeft className="h-4 w-4" />
              {t("editor.header.backLink")}
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              /{page.slug}
            </h1>
            <span className="text-[18px] leading-none">
              {LANGUAGE_FLAGS[page.language]}
            </span>
            {page.active ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                {t("editor.header.live")}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {t("editor.header.offline")}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {page.visit_count.toLocaleString("nl-NL")}
              </span>{" "}
              {t("editor.header.visits")}
            </div>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {page.application_count}
              </span>{" "}
              {t("editor.header.applications")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="outline" className="gap-1.5">
            <a
              href={`/careers/${page.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="h-4 w-4" />
              {t("editor.header.openPublic")}
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={`/career-pages/${page.id}/builder`}>
              <LayoutTemplate className="h-4 w-4" />
              {t("editor.header.buildPage")}
            </Link>
          </Button>
          <Button
            onClick={handleSave}
            disabled={updatePage.isPending}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
          >
            <Save className="h-4 w-4" />
            {updatePage.isPending ? t("editor.header.saving") : t("editor.header.save")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Left: Form ── */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("editor.content.title")}
              </h2>

              <div className="space-y-2">
                <Label htmlFor="hdr">{t("editor.content.headerLabel")}</Label>
                <Input
                  id="hdr"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t("editor.content.headerPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="intro">{t("editor.content.introLabel")}</Label>
                <textarea
                  id="intro"
                  value={introText}
                  onChange={(e) => setIntroText(e.target.value)}
                  placeholder={t("editor.content.introPlaceholder")}
                  className="w-full min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logo">{t("editor.content.logoLabel")}</Label>
                <Input
                  id="logo"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder={t("editor.content.logoPlaceholder")}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("editor.style.title")}
              </h2>

              <div className="space-y-2">
                <Label htmlFor="color">{t("editor.style.colorLabel")}</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="color"
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border border-input bg-background p-1"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="font-mono flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="font">{t("editor.style.fontLabel")}</Label>
                <Select value={fontFamily} onValueChange={setFontFamily}>
                  <SelectTrigger id="font">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tpl">{t("editor.style.templateLabel")}</Label>
                  <Select
                    value={template}
                    onValueChange={(v) =>
                      setTemplate(v as CareerPageTemplate)
                    }
                  >
                    <SelectTrigger id="tpl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TEMPLATE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lang">{t("editor.style.languageLabel")}</Label>
                  <Select
                    value={language}
                    onValueChange={(v) =>
                      setLanguage(v as CareerPageLanguage)
                    }
                  >
                    <SelectTrigger id="lang">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l} value={l}>
                          {LANGUAGE_FLAGS[l]} {LANGUAGE_LABELS[l]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("editor.domain.title")}
                </h2>
                {savedDomain ? (
                  domainVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {t("editor.domain.verified")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {t("editor.domain.notVerified")}
                    </span>
                  )
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">
                {t("editor.domain.description")}
              </p>

              <div className="space-y-2">
                <Label htmlFor="domain">{t("editor.domain.nameLabel")}</Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="domain"
                    value={customDomain}
                    onChange={(e) => setCustomDomain(e.target.value)}
                    placeholder={t("editor.domain.namePlaceholder")}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveDomain}
                  disabled={setDomain.isPending || !domainDirty}
                  className="gap-1.5"
                >
                  {setDomain.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("editor.domain.saving")}
                    </>
                  ) : (
                    t("editor.domain.save")
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerifyDomain}
                  disabled={
                    verifyDomain.isPending || !savedDomain || domainDirty
                  }
                  className="gap-1.5"
                >
                  {verifyDomain.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("editor.domain.verifying")}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {t("editor.domain.verify")}
                    </>
                  )}
                </Button>
                {savedDomain && domainDirty ? (
                  <span className="text-xs text-muted-foreground">
                    {t("editor.domain.saveFirst")}
                  </span>
                ) : null}
              </div>

              {/* DNS-instructie voor de klant */}
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("editor.domain.dnsTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("editor.domain.dnsHelp")}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-muted-foreground text-left">
                        <th className="pr-4 pb-1 font-medium">
                          {t("editor.domain.dnsType")}
                        </th>
                        <th className="pr-4 pb-1 font-medium">
                          {t("editor.domain.dnsHost")}
                        </th>
                        <th className="pb-1 font-medium">
                          {t("editor.domain.dnsValue")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="text-zinc-900 dark:text-zinc-100">
                        <td className="pr-4">A</td>
                        <td className="pr-4">{savedDomain || customDomain.trim() || "werkenbij.bedrijf.nl"}</td>
                        <td>{DNS_TARGET_IP}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("editor.domain.dnsNote")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Live preview ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("editor.livePreview.title")}
            </h2>
            <span className="text-xs text-muted-foreground">
              {t("editor.livePreview.subtitle")}
            </span>
          </div>
          <div className="lg:sticky lg:top-4">
            <LivePreview config={liveConfig} template={template} />
          </div>
        </div>
      </div>
    </div>
  );
}
