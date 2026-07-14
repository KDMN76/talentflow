"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateJob } from "@/hooks/useJobs";
import { useOrganizations } from "@/hooks/useCrm";
import { useToast } from "@/components/ui/use-toast";
import { JobTemplatePicker } from "@/components/jobs/JobTemplatePicker";
import { CustomFieldsRenderer } from "@/components/common/CustomFieldsRenderer";
import { usePaySettings } from "@/hooks/useCompliance";
import type { CustomFieldValue } from "@/lib/types/atsExtensions";
import {
  JOB_SALARY_FREQUENCY_VALUES,
  JobCreateInputSchema,
  type JobCreateInput,
  type JobSalaryFrequency,
} from "@talentflow/contracts";

/**
 * Haal de gestructureerde API-error (`{ error: { code, message } }`) uit een
 * axios-rejectie. Nodig om de 422 PAY_TRANSPARENCY_REQUIRED van de
 * publiceer-gate met de échte NL-melding te tonen i.p.v. "Request failed
 * with status code 422".
 */
function extractApiError(err: unknown): { code?: string; message?: string } {
  const resp = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })
    ?.response;
  return resp?.data?.error ?? {};
}

/**
 * Form-schema = shared `JobCreateInputSchema` met form-specifieke layer:
 *   - `description` krijgt min-length voor UX-feedback voordat backend
 *     het zou afkeuren.
 *   - `salary_min`/`salary_max` worden in `<input type="number">` als string
 *     uitgelezen door react-hook-form; `z.preprocess` coerce leeg→undefined
 *     (zodat we GEEN null sturen — dat was de bug van 2026-05-16) en
 *     anders → integer. Behoudt `optional()` voor leeg-laten.
 *   - `requirements_raw` is een UI-only textarea-veld; wordt vóór submit
 *     gestript en NIET naar backend gestuurd (backend kent geen
 *     `requirements`-veld — was fantoom).
 * `.strict()` van het oorspronkelijke schema blijft behouden via `.extend()`
 * — onbekende velden (typo's, oude form-state) geven Zod-error.
 */
const salaryPreprocess = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? undefined : Number(val)),
  z.number().int().nonnegative().optional()
);

// Schema-factory i.p.v. module-level const: de validatie-messages zijn
// user-facing en komen uit de `jobs`-namespace, dus `t` moet beschikbaar zijn.
const buildJobSchema = (t: TFunction) =>
  JobCreateInputSchema.omit({ pipeline_template_id: true })
    .extend({
      description: z.string().min(10, t("form.validation.descriptionTooShort")),
      department: z.string().min(1, t("form.validation.departmentRequired")),
      location: z.string().min(1, t("form.validation.locationRequired")),
      salary_min: salaryPreprocess,
      salary_max: salaryPreprocess,
      compensation_criteria: z
        .string()
        .max(2000, t("form.validation.compensationCriteriaTooLong"))
        .optional(),
      requirements_raw: z.string().optional(),
    });

type FormData = z.infer<ReturnType<typeof buildJobSchema>>;

interface JobFormProps {
  /** When true, shows the template-picker step before the form. */
  showTemplatePicker?: boolean;
}

export function JobForm({ showTemplatePicker = false }: JobFormProps) {
  const router = useRouter();
  const { t } = useTranslation(["jobs", "common"]);
  const { toast } = useToast();
  const createJob = useCreateJob();
  const { data: organizations } = useOrganizations();
  const { data: paySettings } = usePaySettings();
  const [pickerDone, setPickerDone] = useState(!showTemplatePicker);
  const [customValues, setCustomValues] = useState<Record<string, CustomFieldValue>>({});

  const jobSchema = useMemo(() => buildJobSchema(t), [t]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(jobSchema),
  });

  const watchedMin = watch("salary_min");
  const watchedMax = watch("salary_max");
  const watchedFrequency = watch("salary_frequency");
  const enforced = !!paySettings?.pay_transparency_enforced;

  // Prefill de frequentie met de tenant-default (migration 044) zodra de
  // settings binnen zijn — alleen zolang de gebruiker nog niets koos.
  useEffect(() => {
    if (paySettings?.default_salary_frequency && watchedFrequency === undefined) {
      setValue("salary_frequency", paySettings.default_salary_frequency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paySettings?.default_salary_frequency]);

  // Na de preprocess in jobSchema zijn min/max `number | undefined`. De
  // volledige band = min + max + frequentie (EU 2023/970 art. 5).
  const bandIncomplete =
    watchedMin === undefined ||
    watchedMax === undefined ||
    !watchedFrequency;
  const showPayWarning = enforced && bandIncomplete;

  const handlePickTemplate = (
    jobData: Record<string, unknown>,
    _templateId: string | null
  ) => {
    if (jobData.title) setValue("title", jobData.title as string);
    if (jobData.department) setValue("department", jobData.department as string);
    if (jobData.location) setValue("location", jobData.location as string);
    if (jobData.description) setValue("description", jobData.description as string);
    // Templates bewaren de vereisten in `required_skills` (zie backend
    // TEMPLATEABLE_JOB_FIELDS); de UI toont ze als newline-tekst in
    // `requirements_raw`. Vroeger las dit `jobData.requirements` (fantoomveld) →
    // vereisten kwamen nooit terug bij het kiezen van een template.
    if (Array.isArray(jobData.required_skills)) {
      setValue("requirements_raw", (jobData.required_skills as string[]).join("\n"));
    }
    setPickerDone(true);
  };

  // Smooth-scroll to the form once the user picks a template.
  useEffect(() => {
    if (pickerDone && showTemplatePicker) {
      window.scrollTo({ top: 200, behavior: "smooth" });
    }
  }, [pickerDone, showTemplatePicker]);

  const onSubmit = async (data: FormData, publish: boolean) => {
    // Client-side publiceer-gate (server dwingt hetzelfde af met een 422):
    // een vacature mag alleen live (status 'open') met volledige band.
    if (
      publish &&
      enforced &&
      (data.salary_min === undefined ||
        data.salary_max === undefined ||
        !data.salary_frequency)
    ) {
      toast({
        variant: "destructive",
        title: t("form.toasts.salaryRequired.title"),
        description: t("form.toasts.salaryRequired.description"),
      });
      return;
    }
    try {
      // `data` is al door Zod gevalideerd via resolver — salary_min/max
      // zijn nu numbers of undefined, niet null. We splitsen het UI-only
      // `requirements_raw` af en herbouwen de create-payload expliciet.
      const { requirements_raw, ...rest } = data;
      const createInput: JobCreateInput = { ...rest };

      // Vereisten-textarea (newline-gescheiden) → `required_skills[]`. Dit sluit
      // de round-trip met de template-picker (die vult requirements_raw juist
      // vanuit required_skills). Vroeger werd dit veld volledig weggegooid.
      const requirements = (requirements_raw ?? "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      if (requirements.length > 0) {
        createInput.required_skills = requirements;
      }

      // Custom-field waarden (CustomFieldsRenderer) meesturen; lege waarden
      // weglaten. Vroeger werd `customValues` nergens heen gestuurd.
      const customFieldsPayload = Object.fromEntries(
        Object.entries(customValues).filter(
          ([, v]) => v !== undefined && v !== null && v !== ""
        )
      );
      if (Object.keys(customFieldsPayload).length > 0) {
        createInput.custom_fields = customFieldsPayload;
      }

      // Lege compensation_criteria niet meesturen (DB laat het veld dan NULL).
      if (!createInput.compensation_criteria?.trim()) {
        delete createInput.compensation_criteria;
      }
      const newJob = await createJob.mutateAsync({
        ...createInput,
        status: publish ? "open" : "draft",
      });
      toast({
        title: publish
          ? t("form.toasts.published.title")
          : t("form.toasts.created.title"),
        description: publish
          ? t("form.toasts.published.description", { title: data.title })
          : t("form.toasts.created.description", { title: data.title }),
      });
      router.push(`/jobs/${newJob.id}`);
    } catch (err) {
      const apiError = extractApiError(err);
      if (apiError.code === "PAY_TRANSPARENCY_REQUIRED") {
        // Server-side gate (middleware enforcePayTransparency) — toon de
        // NL-melding met de ontbrekende velden uit de API.
        toast({
          variant: "destructive",
          title: t("form.toasts.salaryRequired.title"),
          description: apiError.message ?? t("form.toasts.salaryRequired.description"),
        });
        return;
      }
      const message =
        apiError.message ??
        (err instanceof Error ? err.message : t("form.toasts.createError.fallback"));
      toast({
        variant: "destructive",
        title: t("form.toasts.createError.title"),
        description: message,
      });
    }
  };

  return (
    <div className="space-y-6">
      {showTemplatePicker && !pickerDone && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("form.templatePicker.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <JobTemplatePicker onPick={handlePickTemplate} />
          </CardContent>
        </Card>
      )}

      <form onSubmit={handleSubmit((d) => onSubmit(d, false))} className="space-y-6">
        {showPayWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t("form.payWarning.title")}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  {t("form.payWarning.description")}
                </p>
                <Link
                  href="/settings/pay-transparency"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                >
                  {t("form.payWarning.settingsLink")}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        )}

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("form.sections.basicInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t("form.titleLabel")} *</Label>
              <Input
                id="title"
                placeholder={t("form.titlePlaceholder")}
                {...register("title")}
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department">{t("form.departmentLabel")} *</Label>
                <Input
                  id="department"
                  placeholder={t("form.departmentPlaceholder")}
                  {...register("department")}
                  className={errors.department ? "border-destructive" : ""}
                />
                {errors.department && (
                  <p className="text-xs text-destructive">
                    {errors.department.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">{t("form.locationLabel")} *</Label>
                <Input
                  id="location"
                  placeholder={t("form.locationPlaceholder")}
                  {...register("location")}
                  className={errors.location ? "border-destructive" : ""}
                />
                {errors.location && (
                  <p className="text-xs text-destructive">
                    {errors.location.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization_id">{t("form.clientLabel")}</Label>
              <Select
                value={(watch("organization_id") as string | null | undefined) ?? "none"}
                onValueChange={(v) =>
                  setValue("organization_id", v === "none" ? null : v)
                }
              >
                <SelectTrigger id="organization_id">
                  <SelectValue placeholder={t("form.clientPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("form.clientNone")}</SelectItem>
                  {(organizations ?? []).map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("form.sections.descriptionRequirements")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="description">{t("form.descriptionLabel")} *</Label>
              <textarea
                id="description"
                rows={5}
                placeholder={t("form.descriptionPlaceholder")}
                {...register("description")}
                className={`flex min-h-[120px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none ${errors.description ? "border-destructive" : ""}`}
              />
              {errors.description && (
                <p className="text-xs text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="requirements_raw">
                {t("form.requirementsLabel")}
              </Label>
              <textarea
                id="requirements_raw"
                rows={4}
                placeholder={t("form.requirementsPlaceholder")}
                {...register("requirements_raw")}
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              {t("form.sections.salary")}
              {enforced && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-1.5 py-0.5 rounded">
                  {t("form.euRequiredBadge")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="salary_min">
                  {t("form.salaryMinLabel")}
                  {enforced && " *"}
                </Label>
                <Input
                  id="salary_min"
                  type="number"
                  min={0}
                  step={1000}
                  placeholder="50000"
                  {...register("salary_min")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="salary_max">
                  {t("form.salaryMaxLabel")}
                  {enforced && " *"}
                </Label>
                <Input
                  id="salary_max"
                  type="number"
                  min={0}
                  step={1000}
                  placeholder="70000"
                  {...register("salary_max")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="salary_frequency">
                  {t("form.salaryFrequencyLabel")}
                  {enforced && " *"}
                </Label>
                <Select
                  value={watchedFrequency ?? ""}
                  onValueChange={(v) =>
                    setValue("salary_frequency", v as JobSalaryFrequency)
                  }
                >
                  <SelectTrigger id="salary_frequency">
                    <SelectValue
                      placeholder={t("form.salaryFrequencyPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_SALARY_FREQUENCY_VALUES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`form.salaryFrequencies.${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="compensation_criteria">
                {t("form.compensationCriteriaLabel")}
              </Label>
              <textarea
                id="compensation_criteria"
                rows={3}
                placeholder={t("form.compensationCriteriaPlaceholder")}
                {...register("compensation_criteria")}
                className={`flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none ${errors.compensation_criteria ? "border-destructive" : ""}`}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("form.compensationCriteriaHelp")}
              </p>
              {errors.compensation_criteria && (
                <p className="text-xs text-destructive">
                  {errors.compensation_criteria.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <CustomFieldsRenderer
              entityType="job"
              values={customValues}
              onChange={(key, value) =>
                setCustomValues((cur) => ({ ...cur, [key]: value }))
              }
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/jobs")}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={createJob.isPending}
          >
            {createJob.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("form.submit")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit((d) => onSubmit(d, true))}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            disabled={createJob.isPending || showPayWarning}
            title={
              showPayWarning ? t("form.publishBlockedTooltip") : undefined
            }
          >
            {createJob.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("form.publish")}
          </Button>
        </div>
      </form>
    </div>
  );
}
