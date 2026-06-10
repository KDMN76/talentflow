"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/api";
import { setToken, isMockMode, MOCK_DEV_TOKEN } from "@/lib/auth";
import { AxiosError } from "axios";

const registerSchema = z.object({
  tenantName: z.string().min(2, "Bedrijfsnaam is verplicht"),
  tenantSlug: z
    .string()
    .min(2, "Workspace-slug is verplicht")
    .max(50, "Slug mag maximaal 50 tekens bevatten")
    .regex(/^[a-z0-9-]+$/, "Slug mag alleen kleine letters, cijfers en koppeltekens bevatten"),
  name: z.string().min(2, "Naam is verplicht"),
  email: z.string().email("Ongeldig e-mailadres"),
  password: z.string().min(8, "Wachtwoord moet minimaal 8 tekens bevatten"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      // Explicit dev-only mock-mode: ONLY when developer opts in via
      // NEXT_PUBLIC_USE_MOCK_DATA=true. Never used as silent fallback.
      if (isMockMode()) {
        setToken(MOCK_DEV_TOKEN);
        router.push("/dashboard");
        return;
      }

      const response = await api.post("/auth/register", data);
      setToken(response.data.accessToken);
      toast({
        title: t("register.success.title"),
        description: t("register.success.description", { name: data.name }),
      });
      router.push("/dashboard");
    } catch (error) {
      // No silent fallback — surface the failure to the user.
      let description = t("errors.generic");

      if (error instanceof AxiosError) {
        if (!error.response) {
          description = t("errors.network");
        } else if (error.response.status === 409) {
          description = t("register.errors.conflict");
        } else if (error.response.status === 429) {
          description = t("register.errors.tooManyAttempts");
        } else if (error.response.status >= 500) {
          description = t("errors.server");
        } else {
          const apiMessage = (error.response.data as { message?: string })
            ?.message;
          if (apiMessage) description = apiMessage;
        }
      }

      toast({
        variant: "destructive",
        title: t("register.errors.title"),
        description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-0 shadow-2xl shadow-indigo-100/50 dark:shadow-black/30">
      <CardHeader className="space-y-4 pb-6">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
        </div>
        <div>
          <CardTitle className="text-2xl font-bold">
            {t("register.title")}
          </CardTitle>
          <CardDescription className="mt-1 text-base">
            {t("register.subtitle")}
          </CardDescription>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenantName">{t("register.companyNameLabel")}</Label>
            <Input
              id="tenantName"
              placeholder={t("register.companyNamePlaceholder")}
              {...register("tenantName")}
              className={errors.tenantName ? "border-destructive" : ""}
            />
            {errors.tenantName && (
              <p className="text-sm text-destructive">
                {errors.tenantName.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenantSlug">{t("register.workspaceLabel")}</Label>
            <Input
              id="tenantSlug"
              placeholder={t("register.workspacePlaceholder")}
              {...register("tenantSlug")}
              className={errors.tenantSlug ? "border-destructive" : ""}
            />
            <p className="text-xs text-muted-foreground">{t("register.workspaceHint")}</p>
            {errors.tenantSlug && (
              <p className="text-sm text-destructive">
                {errors.tenantSlug.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t("register.nameLabel")}</Label>
            <Input
              id="name"
              placeholder={t("register.namePlaceholder")}
              autoComplete="name"
              {...register("name")}
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t("register.emailLabel")}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t("register.emailPlaceholder")}
              autoComplete="email"
              {...register("email")}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("register.passwordLabel")}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t("register.passwordPlaceholder")}
              autoComplete="new-password"
              {...register("password")}
              className={errors.password ? "border-destructive" : ""}
            />
            {errors.password && (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4 pt-2">
          <Button
            type="submit"
            className="w-full h-11 text-base font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-200/50 border-0"
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("register.submit")}
          </Button>

          <p className="text-sm text-center text-muted-foreground">
            {t("register.haveAccount")}{" "}
            <Link
              href="/login"
              className="text-primary font-medium hover:underline"
            >
              {t("register.loginLink")}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
