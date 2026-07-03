"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
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
import { AxiosError } from "axios";

const forgotPasswordSchema = z.object({
  tenantSlug: z.string().min(1, "Workspace is verplicht"),
  email: z.string().email("Ongeldig e-mailadres"),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const { t } = useTranslation("auth");
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  // De API antwoordt altijd neutraal 200 (geen user-enumeration) — dus na
  // submit tonen we altijd dezelfde "check je mail"-state.
  const [isSubmitted, setIsSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    setIsLoading(true);
    try {
      await api.post("/auth/forgot-password", data);
      setIsSubmitted(true);
    } catch (error) {
      let description = t("errors.generic");
      if (error instanceof AxiosError) {
        if (!error.response) {
          description = t("errors.network");
        } else if (error.response.status === 429) {
          description = t("forgotPassword.errors.tooManyAttempts");
        } else if (error.response.status >= 500) {
          description = t("errors.server");
        }
      }
      toast({
        variant: "destructive",
        title: t("forgotPassword.errors.title"),
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
            <KeyRound className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
        </div>
        <div>
          <CardTitle className="text-2xl font-bold">
            {t("forgotPassword.title")}
          </CardTitle>
          <CardDescription className="mt-1 text-base">
            {isSubmitted
              ? t("forgotPassword.successSubtitle")
              : t("forgotPassword.subtitle")}
          </CardDescription>
        </div>
      </CardHeader>

      {isSubmitted ? (
        <>
          <CardContent>
            <div
              className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950"
              role="status"
            >
              <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                {t("forgotPassword.success.description")}
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 pt-2">
            <p className="text-sm text-center text-muted-foreground">
              {t("forgotPassword.backToLoginPrompt")}{" "}
              <Link
                href="/login"
                className="text-primary font-medium hover:underline"
              >
                {t("forgotPassword.backToLogin")}
              </Link>
            </p>
          </CardFooter>
        </>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenantSlug">
                {t("forgotPassword.workspaceLabel")}
              </Label>
              <Input
                id="tenantSlug"
                type="text"
                placeholder={t("forgotPassword.workspacePlaceholder")}
                autoComplete="organization"
                {...register("tenantSlug")}
                className={errors.tenantSlug ? "border-destructive" : ""}
              />
              {errors.tenantSlug && (
                <p className="text-sm text-destructive">
                  {errors.tenantSlug.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t("forgotPassword.emailLabel")}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t("forgotPassword.emailPlaceholder")}
                autoComplete="email"
                {...register("email")}
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
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
              {t("forgotPassword.submit")}
            </Button>

            <p className="text-sm text-center text-muted-foreground">
              {t("forgotPassword.backToLoginPrompt")}{" "}
              <Link
                href="/login"
                className="text-primary font-medium hover:underline"
              >
                {t("forgotPassword.backToLogin")}
              </Link>
            </p>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
