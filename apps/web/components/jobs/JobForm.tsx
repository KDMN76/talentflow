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
import { JobCreateInputSchema } from "@talentflow/contracts";

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
  // Na de preprocess in jobSchema zijn deze `number | undefined`.
  const salaryMissing = watchedMin === undefined || watchedMax === undefined;
  const showPayWarning = !!paySettings?.enforce_salary_range && salaryMissing;

  const handlePickTemplate = (
    jobData: Record<string, unknown>,
    _templateId: string | null
  ) => {
    if (jobData.title) setValue("title", jobData.title as string);
    if (jobData.department) setValue("department", jobData.department as string);
    if (jobData.location) setValue("location", jobData.location as string);
    if (jobData.description) setValue("description", jobData.description as string);
    if (Array.isArray(jobData.requirements)) {
      setValue("requirements_raw", (jobData.requirements as string[]).join("\n"));
    }
    setPickerDone(true);
  };

  // Smooth-scroll to the form once the user picks a template.
  useEffect(() => {
    if (pickerDone && showTemplatePicker) {
      window.scrollTo({ top: 200, behavior: "smooth" });
    }
  }, [pickerDone, showTemplatePicker]);

  const onSubmit = async (data: FormData) => {
    if (
      paySettings?.enforce_salary_range &&
      (data.salary_min === undefined || data.salary_max === undefined)
    ) {
      toast({
        variant: "destructive",
        title: t("form.toasts.salaryRequired.title"),
        description: t("form.toasts.salaryRequired.description"),
      });
      return;
    }
    try {
      // Strip UI-only `requirements_raw` (backend kent het veld niet).
      // `data` is al door Zod gevalideerd via resolver — salary_min/max
      // zijn nu numbers of undefined, niet null.
      const { requirements_raw: _requirements_raw, ...createInput } = data;
      const newJob = await createJob.mutateAsync(createInput);
      toast({
        title: t("form.toasts.created.title"),
        description: t("form.toasts.created.description", { title: data.title }),
      });
      router.push(`/jobs/${newJob.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("form.toasts.createError.fallback");
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

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
              {paySettings?.enforce_salary_range && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-1.5 py-0.5 rounded">
                  {t("form.euRequiredBadge")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="salary_min">
                  {t("form.salaryMinLabel")}
                  {paySettings?.enforce_salary_range && " *"}
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
                  {paySettings?.enforce_salary_range && " *"}
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
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            disabled={createJob.isPending}
          >
            {createJob.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("form.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
