"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Palette, Save, Sparkles, Upload } from "lucide-react";
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
  type TenantBranding,
} from "@/hooks/useTenantBranding";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface FormState extends TenantBranding {}

export default function BrandingSettingsPage() {
  const { t } = useTranslation("settingsCore");
  const { data, isLoading } = useTenantBranding();
  const update = useUpdateTenantBranding();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!HEX_COLOR_PATTERN.test(form.primary_color)) {
      toast({
        variant: "destructive",
        title: t("branding.toasts.invalidPrimary.title"),
        description: t("branding.toasts.invalidPrimary.description"),
      });
      return;
    }
    if (!HEX_COLOR_PATTERN.test(form.accent_color)) {
      toast({
        variant: "destructive",
        title: t("branding.toasts.invalidAccent.title"),
        description: t("branding.toasts.invalidAccent.description"),
      });
      return;
    }
    update.mutate(form, {
      onSuccess: () =>
        toast({
          title: t("branding.toasts.updated.title"),
          description: t("branding.toasts.updated.description"),
        }),
      onError: () =>
        toast({
          variant: "destructive",
          title: t("branding.toasts.saveError.title"),
          description: t("branding.toasts.saveError.description"),
        }),
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {t("branding.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("branding.description")}
        </p>
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
              <CardDescription>
                {t("branding.logo.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="logo_url">{t("branding.logo.logoUrlLabel")}</Label>
                <Input
                  id="logo_url"
                  type="url"
                  placeholder={t("branding.logo.logoUrlPlaceholder")}
                  value={form.logo_url ?? ""}
                  onChange={(e) =>
                    setField("logo_url", e.target.value.trim() || null)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="favicon_url">{t("branding.logo.faviconUrlLabel")}</Label>
                <Input
                  id="favicon_url"
                  type="url"
                  placeholder={t("branding.logo.faviconUrlPlaceholder")}
                  value={form.favicon_url ?? ""}
                  onChange={(e) =>
                    setField("favicon_url", e.target.value.trim() || null)
                  }
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
              <CardDescription>
                {t("branding.colors.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="primary_color">{t("branding.colors.primaryLabel")}</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={form.primary_color}
                    onChange={(e) => setField("primary_color", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-border"
                    aria-label={t("branding.colors.primaryAria")}
                  />
                  <Input
                    id="primary_color"
                    value={form.primary_color}
                    onChange={(e) => setField("primary_color", e.target.value)}
                    placeholder="#6366f1"
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="accent_color">Accent kleur</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={form.accent_color}
                    onChange={(e) => setField("accent_color", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-border"
                    aria-label="Accent kleur"
                  />
                  <Input
                    id="accent_color"
                    value={form.accent_color}
                    onChange={(e) => setField("accent_color", e.target.value)}
                    placeholder="#8b5cf6"
                    className="font-mono"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Merknaam & email-footer</CardTitle>
              <CardDescription>
                Override de TalentFlow-naam en voeg een eigen email-handtekening toe.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brand_name">Merknaam (override)</Label>
                <Input
                  id="brand_name"
                  placeholder="Jouw bureau-naam"
                  value={form.brand_name_override ?? ""}
                  onChange={(e) =>
                    setField(
                      "brand_name_override",
                      e.target.value.trim() || null
                    )
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Leeg = standaard tenant-naam.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email_footer_html">Email footer (HTML)</Label>
                <textarea
                  id="email_footer_html"
                  rows={6}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="<p>Met vriendelijke groet,<br/>Het team</p>"
                  value={form.email_footer_html}
                  onChange={(e) => setField("email_footer_html", e.target.value)}
                />
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
              Opslaan
            </Button>
          </div>
        </div>

        {/* Preview lane */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Live preview
              </CardTitle>
              <CardDescription>
                Hoe je portaal en emails er voor klanten uitzien.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Portal-header preview */}
              <div className="overflow-hidden rounded-lg border border-border">
                <div
                  className="flex items-center gap-3 px-4 py-3 text-white"
                  style={{ backgroundColor: form.primary_color }}
                >
                  {form.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.logo_url}
                      alt="logo"
                      className="h-8 w-auto rounded bg-white/20 p-1"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-xs font-bold">
                      LOGO
                    </div>
                  )}
                  <div className="text-sm font-semibold">
                    {form.brand_name_override ?? "Jouw bureau"}
                  </div>
                </div>
                <div className="space-y-2 bg-card p-4">
                  <div className="text-xs text-muted-foreground">
                    Recruitment portaal
                  </div>
                  <div
                    className="inline-block rounded px-2 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: form.accent_color }}
                  >
                    AI Match: 92%
                  </div>
                  <div className="text-sm text-zinc-700 dark:text-zinc-300">
                    Voorbeeld kandidaat — Functietitel
                  </div>
                </div>
              </div>

              {/* Email-footer preview */}
              <div className="overflow-hidden rounded-lg border border-border bg-zinc-50 p-4 dark:bg-zinc-900/40">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Email footer
                </div>
                <div
                  className="text-sm text-zinc-700 dark:text-zinc-300 [&_a]:text-current [&_a]:underline"
                  dangerouslySetInnerHTML={{
                    __html:
                      form.email_footer_html ||
                      '<p class="text-muted-foreground italic">Geen footer ingesteld.</p>',
                  }}
                />
              </div>

              <p className="text-[11px] text-muted-foreground">
                Wijzigingen worden direct toegepast na opslaan — bestaande
                portaal-links zien meteen de nieuwe branding.
              </p>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
