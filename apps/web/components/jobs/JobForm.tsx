"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import { useToast } from "@/components/ui/use-toast";
import { JobTemplatePicker } from "@/components/jobs/JobTemplatePicker";
import { CustomFieldsRenderer } from "@/components/common/CustomFieldsRenderer";
import { usePaySettings } from "@/hooks/useCompliance";
import type { CustomFieldValue } from "@/lib/types/atsExtensions";

const jobSchema = z.object({
  title: z.string().min(2, "Functietitel is verplicht"),
  department: z.string().min(1, "Afdeling is verplicht"),
  location: z.string().min(1, "Locatie is verplicht"),
  description: z.string().min(10, "Omschrijving is te kort"),
  requirements_raw: z.string().optional(),
  salary_min: z.string().optional(),
  salary_max: z.string().optional(),
});

type FormData = z.infer<typeof jobSchema>;

interface JobFormProps {
  /** When true, shows the template-picker step before the form. */
  showTemplatePicker?: boolean;
}

export function JobForm({ showTemplatePicker = false }: JobFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const createJob = useCreateJob();
  const { data: paySettings } = usePaySettings();
  const [pickerDone, setPickerDone] = useState(!showTemplatePicker);
  const [customValues, setCustomValues] = useState<Record<string, CustomFieldValue>>({});

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
  const salaryMissing =
    !watchedMin || !watchedMax || watchedMin === "" || watchedMax === "";
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
    if (paySettings?.enforce_salary_range && (!data.salary_min || !data.salary_max)) {
      toast({
        variant: "destructive",
        title: "Salarisbandbreedte verplicht",
        description:
          "Je tenant verplicht salaris-transparantie volgens EU 2023/970. Vul min en max in.",
      });
      return;
    }
    try {
      const newJob = await createJob.mutateAsync({
        title: data.title,
        department: data.department,
        location: data.location,
        description: data.description,
        salary_min: data.salary_min ? Number(data.salary_min) : null,
        salary_max: data.salary_max ? Number(data.salary_max) : null,
        requirements: data.requirements_raw
          ? data.requirements_raw
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      });
      toast({
        title: "Vacature aangemaakt",
        description: `"${data.title}" is opgeslagen als concept.`,
      });
      router.push(`/jobs/${newJob.id}`);
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Vacature kon niet worden aangemaakt.",
      });
    }
  };

  return (
    <div className="space-y-6">
      {showTemplatePicker && !pickerDone && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Begin van een template?</CardTitle>
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
                  EU Pay Transparency Directive vereist een salarisbandbreedte
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  Zonder ingevulde minimum- en maximum-salaris kan deze vacature
                  niet worden gepubliceerd. Vul de bandbreedte hieronder in.
                </p>
                <Link
                  href="/settings/pay-transparency"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                >
                  Naar Pay Transparency-instellingen
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        )}

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Basisinformatie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Functietitel *</Label>
              <Input
                id="title"
                placeholder="Senior Frontend Developer"
                {...register("title")}
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="department">Afdeling *</Label>
                <Input
                  id="department"
                  placeholder="Engineering"
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
                <Label htmlFor="location">Locatie *</Label>
                <Input
                  id="location"
                  placeholder="Amsterdam (hybride)"
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
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Omschrijving & eisen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="description">Functieomschrijving *</Label>
              <textarea
                id="description"
                rows={5}
                placeholder="Beschrijf de functie, het team en de verantwoordelijkheden..."
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
                Vereisten (één per regel, optioneel)
              </Label>
              <textarea
                id="requirements_raw"
                rows={4}
                placeholder="5+ jaar React ervaring&#10;TypeScript expertise&#10;Ervaring met Next.js"
                {...register("requirements_raw")}
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              Salaris
              {paySettings?.enforce_salary_range && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 px-1.5 py-0.5 rounded">
                  EU verplicht
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="salary_min">
                  Minimum (EUR/jaar)
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
                  Maximum (EUR/jaar)
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
            Annuleren
          </Button>
          <Button
            type="submit"
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            disabled={createJob.isPending}
          >
            {createJob.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Vacature aanmaken
          </Button>
        </div>
      </form>
    </div>
  );
}
