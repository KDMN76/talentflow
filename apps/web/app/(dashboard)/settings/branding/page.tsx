"use client";

/**
 * Branding-instellingen (white-label) — gekoppeld aan de echte API.
 *
 * - Logo: échte upload (PNG/JPG/SVG ≤ 1MB) via POST /tenants/branding/logo;
 *   server valideert magic bytes + SVG-scrub. Verwijderen via DELETE.
 *   logo_url wordt dus NIET via de PUT beheerd — de save stuurt het veld
 *   bewust niet mee zodat een geüpload logo nooit wordt overschreven.
 * - Kleuren: 6-cijferige hex (API-eis) + WCAG 3:1 contrast-check (1.4.11).
 * - Live preview rechts: portaal-header, accent-badge en e-mailfooter.
 * - E-mailfooter wordt server-side gesaneerd (strikte allowlist,
 *   lib/emailFooter.ts) vóór hij onder uitgaande mails komt.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Loader2,
  Palette,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useTenantBranding,
  useUpdateTenantBranding,
  useUploadTenantLogo,
  useDeleteTenantLogo,
} from "@/hooks/useTenantBranding";
import { meetsUiContrast } from "@/lib/color";

/** API accepteert alleen #rrggbb (zes hex-cijfers). */
const HEX6_PATTERN = /^#[0-9a-fA-F]{6}$/;

const DEFAULT_PRIMARY = "#6366f1";
const DEFAULT_ACCENT = "#8b5cf6";

const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB — zelfde cap als de API
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];

interface FormState {
  favicon_url: string;
  primary_color: string;
  accent_color: string;
  brand_name: string;
  email_footer: string;
}

/** Leesbare foutmelding uit een API-error (axios-shape) of fallback. */
function apiErrorMessage(err: unknown, fallback: string): string {
  const maybe = err as {
    response?: { data?: { error?: { message?: string } } };
  };
  return maybe?.response?.data?.error?.message ?? fallback;
}

export default function BrandingSettingsPage() {
  const { t } = useTranslation("settingsCore");
  const { data: branding, isLoading } = useTenantBranding();
  const update = useUpdateTenantBranding();
  const uploadLogo = useUploadTenantLogo();
  const deleteLogo = useDeleteTenantLogo();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    // branding kan null zijn (nog geen rij) — dan starten we met defaults.
    if (!isLoading && !form) {
      setForm({
        favicon_url: branding?.favicon_url ?? "",
        primary_color: branding?.primary_color ?? DEFAULT_PRIMARY,
        accent_color: branding?.accent_color ?? DEFAULT_ACCENT,
        brand_name: branding?.brand_name ?? "",
        email_footer: branding?.email_footer ?? "",
      });
    }
  }, [branding, isLoading, form]);

  if (isLoading || !form) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const logoUrl = branding?.logo_url ?? null;

  // WCAG 1.4.11: accent/primair worden als knop-/badge-achtergrond gebruikt —
  // minimaal 3:1 contrast met de best mogelijke tekstkleur erop.
  const primaryContrastOk =
    !HEX6_PATTERN.test(form.primary_color) || meetsUiContrast(form.primary_color);
  const accentContrastOk =
    !HEX6_PATTERN.test(form.accent_color) || meetsUiContrast(form.accent_color);

  const handleLogoSelect = (file: File | null) => {
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      toast({
        variant: "destructive",
        title: t("branding.toasts.logoUploadError.title"),
        description: t("branding.logo.invalidType"),
      });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({
        variant: "destructive",
        title: t("branding.toasts.logoUploadError.title"),
        description: t("branding.logo.tooLarge"),
      });
      return;
    }
    uploadLogo.mutate(file, {
      onSuccess: () =>
        toast({
          title: t("branding.toasts.logoUploaded.title"),
          description: t("branding.toasts.logoUploaded.description"),
        }),
      onError: (err) =>
        toast({
          variant: "destructive",
          title: t("branding.toasts.logoUploadError.title"),
          description: apiErrorMessage(
            err,
            t("branding.toasts.logoUploadError.description")
          ),
        }),
    });
  };

  const handleLogoDelete = () => {
    deleteLogo.mutate(undefined, {
      onSuccess: () =>
        toast({
          title: t("branding.toasts.logoRemoved.title"),
          description: t("branding.toasts.logoRemoved.description"),
        }),
      onError: (err) =>
        toast({
          variant: "destructive",
          title: t("branding.toasts.logoRemoveError.title"),
          description: apiErrorMessage(
            err,
            t("branding.toasts.logoRemoveError.description")
          ),
        }),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!HEX6_PATTERN.test(form.primary_color)) {
      toast({
        variant: "destructive",
        title: t("branding.toasts.invalidPrimary.title"),
        description: t("branding.toasts.invalidPrimary.description"),
      });
      return;
    }
    if (!HEX6_PATTERN.test(form.accent_color)) {
      toast({
        variant: "destructive",
        title: t("branding.toasts.invalidAccent.title"),
        description: t("branding.toasts.invalidAccent.description"),
      });
      return;
    }
    // logo_url bewust NIET meesturen: dat veld beheren de upload-endpoints.
    // Lege strings → null (expliciet wissen; de PUT kent undefined ≠ null).
    update.mutate(
      {
        favicon_url: form.favicon_url.trim() || null,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
        brand_name: form.brand_name.trim() || null,
        email_footer: form.email_footer.trim() || null,
      },
      {
        onSuccess: () =>
          toast({
            title: t("branding.toasts.updated.title"),
            description: t("branding.toasts.updated.description"),
          }),
        onError: (err) =>
          toast({
            variant: "destructive",
            title: t("branding.toasts.saveError.title"),
            description: apiErrorMessage(
              err,
              t("branding.toasts.saveError.description")
            ),
          }),
      }
    );
  };

  const previewBrandName = form.brand_name.trim() || t("branding.preview.brandFallback");
  const previewPrimary = HEX6_PATTERN.test(form.primary_color)
    ? form.primary_color
    : DEFAULT_PRIMARY;
  const previewAccent = HEX6_PATTERN.test(form.accent_color)
    ? form.accent_color
    : DEFAULT_ACCENT;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {t("branding.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("branding.description")}</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Form lane */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4 text-indigo-500" />
                {t("branding.logo.title")}
              </CardTitle>
              <CardDescription>{t("branding.logo.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-zinc-50 dark:bg-zinc-900/40">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt={t("branding.logo.currentAlt")}
                      className="max-h-14 max-w-[7.5rem] object-contain"
                    />
                  ) : (
                    <span className="px-2 text-center text-xs text-muted-foreground">
                      {t("branding.logo.noLogo")}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadLogo.isPending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadLogo.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {logoUrl
                        ? t("branding.logo.replaceButton")
                        : t("branding.logo.uploadButton")}
                    </Button>
                    {logoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                        disabled={deleteLogo.isPending}
                        onClick={handleLogoDelete}
                      >
                        {deleteLogo.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        {t("branding.logo.removeButton")}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("branding.logo.uploadHint")}
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    handleLogoSelect(e.target.files?.[0] ?? null);
                    e.target.value = ""; // zelfde bestand opnieuw kunnen kiezen
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="favicon_url">{t("branding.logo.faviconUrlLabel")}</Label>
                <Input
                  id="favicon_url"
                  type="url"
                  placeholder={t("branding.logo.faviconUrlPlaceholder")}
                  value={form.favicon_url}
                  onChange={(e) => setField("favicon_url", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Palette className="h-4 w-4 text-purple-500" />
                {t("branding.colors.title")}
              </CardTitle>
              <CardDescription>{t("branding.colors.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="primary_color">{t("branding.colors.primaryLabel")}</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={previewPrimary}
                    onChange={(e) => setField("primary_color", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-border"
                    aria-label={t("branding.colors.primaryAria")}
                  />
                  <Input
                    id="primary_color"
                    value={form.primary_color}
                    onChange={(e) => setField("primary_color", e.target.value)}
                    placeholder={DEFAULT_PRIMARY}
                    className="font-mono"
                  />
                </div>
                {!primaryContrastOk && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t("branding.colors.contrastWarning")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="accent_color">{t("branding.colors.accentLabel")}</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={previewAccent}
                    onChange={(e) => setField("accent_color", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-border"
                    aria-label={t("branding.colors.accentAria")}
                  />
                  <Input
                    id="accent_color"
                    value={form.accent_color}
                    onChange={(e) => setField("accent_color", e.target.value)}
                    placeholder={DEFAULT_ACCENT}
                    className="font-mono"
                  />
                </div>
                {!accentContrastOk && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t("branding.colors.contrastWarning")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("branding.brand.title")}</CardTitle>
              <CardDescription>{t("branding.brand.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brand_name">{t("branding.brand.nameLabel")}</Label>
                <Input
                  id="brand_name"
                  maxLength={100}
                  placeholder={t("branding.brand.namePlaceholder")}
                  value={form.brand_name}
                  onChange={(e) => setField("brand_name", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("branding.brand.nameHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email_footer">{t("branding.brand.footerLabel")}</Label>
                <textarea
                  id="email_footer"
                  rows={6}
                  maxLength={5000}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={t("branding.brand.footerPlaceholder")}
                  value={form.email_footer}
                  onChange={(e) => setField("email_footer", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("branding.brand.footerHint")}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t("branding.save")}
            </Button>
          </div>
        </div>

        {/* Preview lane */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                {t("branding.preview.title")}
              </CardTitle>
              <CardDescription>{t("branding.preview.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Portal-header preview */}
              <div className="overflow-hidden rounded-lg border border-border">
                <div
                  className="flex items-center gap-3 px-4 py-3 text-white"
                  style={{ backgroundColor: previewPrimary }}
                >
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt={t("branding.logo.currentAlt")}
                      className="h-8 w-auto rounded bg-white/20 p-1"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-xs font-bold">
                      LOGO
                    </div>
                  )}
                  <div className="text-sm font-semibold">{previewBrandName}</div>
                </div>
                <div className="space-y-2 bg-card p-4">
                  <div className="text-xs text-muted-foreground">
                    {t("branding.preview.portalLabel")}
                  </div>
                  <div
                    className="inline-block rounded px-2 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: previewAccent }}
                  >
                    {t("branding.preview.badgeExample")}
                  </div>
                  <div className="text-sm text-zinc-700 dark:text-zinc-300">
                    {t("branding.preview.candidateExample")}
                  </div>
                </div>
              </div>

              {/* Email-footer preview — de eigen input van de admin; de échte
                  mails krijgen de server-side gesaneerde variant. */}
              <div className="overflow-hidden rounded-lg border border-border bg-zinc-50 p-4 dark:bg-zinc-900/40">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {t("branding.preview.emailFooterTitle")}
                </div>
                {form.email_footer.trim() ? (
                  <div
                    className="text-sm text-zinc-700 dark:text-zinc-300 [&_a]:text-current [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: form.email_footer }}
                  />
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    {t("branding.preview.noFooter")}
                  </p>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">
                {t("branding.preview.note")}
              </p>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
