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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/api";
import { setToken, isMockMode, MOCK_DEV_TOKEN } from "@/lib/auth";
import { AxiosError } from "axios";

const loginSchema = z.object({
  email: z.string().email("Ongeldig e-mailadres"),
  password: z.string().min(6, "Wachtwoord moet minimaal 6 tekens bevatten"),
  tenantSlug: z.string().min(1, "Workspace is verplicht"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      // Explicit dev-only mock-mode: ONLY when developer opts in via
      // NEXT_PUBLIC_USE_MOCK_DATA=true. Never used as silent fallback.
      if (isMockMode()) {
        setToken(MOCK_DEV_TOKEN);
        router.push("/dashboard");
        return;
      }

      const response = await api.post("/auth/login", data);

      // De API geeft {requires_2fa:true, partial_token} terug (ZONDER
      // accessToken) als de gebruiker 2FA aan heeft staan. Token hier opslaan
      // zou `undefined` persisten → 401 overal. Stuur door naar de challenge.
      if (response.data?.requires_2fa) {
        // partial_token is kortlevend (5m); via sessionStorage i.p.v. de URL
        // zodat het JWT niet in history/referrer-logs belandt.
        sessionStorage.setItem("tf_partial_token", response.data.partial_token);
        router.push("/2fa");
        return;
      }

      setToken(response.data.accessToken);
      router.push("/dashboard");
    } catch (error) {
      // No silent fallback — surface the failure to the user.
      let description = t("errors.generic");

      if (error instanceof AxiosError) {
        if (!error.response) {
          // Network error / API unreachable
          description = t("errors.network");
        } else if (error.response.status === 401) {
          description = t("login.errors.invalidCredentials");
        } else if (error.response.status === 404) {
          description = t("login.errors.workspaceNotFound");
        } else if (error.response.status === 429) {
          description = t("login.errors.tooManyAttempts");
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
        title: t("login.errors.title"),
        description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-0 shadow-2xl shadow-indigo-100/50 dark:shadow-black/30">
      <CardHeader className="space-y-4 pb-6">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
        </div>
        <div>
          <CardTitle className="text-2xl font-bold">{t("login.title")}</CardTitle>
          <CardDescription className="mt-1 text-base">
            {t("login.subtitle")}
          </CardDescription>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenantSlug">{t("login.workspaceLabel")}</Label>
            <Input
              id="tenantSlug"
              type="text"
              placeholder={t("login.workspacePlaceholder")}
              autoComplete="organization"
              {...register("tenantSlug")}
              className={errors.tenantSlug ? "border-destructive" : ""}
            />
            {errors.tenantSlug && (
              <p className="text-sm text-destructive">{errors.tenantSlug.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t("login.emailLabel")}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t("login.emailPlaceholder")}
              autoComplete="email"
              {...register("email")}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("login.passwordLabel")}</Label>
              <Link
                href="#"
                className="text-sm text-primary hover:underline font-medium"
              >
                {t("login.forgotPassword")}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
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
            {t("login.submit")}
          </Button>

          {/* Hotfix 2026-05-15: publieke registratie tijdelijk uit (zie
              auth.controller.ts) — invite-only flow komt morgen. CTA verborgen
              zodat we geen kapotte UX laten zien. */}
          {process.env.NEXT_PUBLIC_DISABLE_PUBLIC_REGISTRATION !== "true" && (
            <p className="text-sm text-center text-muted-foreground">
              {t("login.noAccount")}{" "}
              <Link
                href="/register"
                className="text-primary font-medium hover:underline"
              >
                {t("login.registerLink")}
              </Link>
            </p>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
