"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, LockKeyhole } from "lucide-react";
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

// useSearchParams vereist een dynamische render; opt de route uit static gen.
export const dynamic = "force-dynamic";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Wachtwoord moet minimaal 8 tekens bevatten"),
    confirm: z.string().min(8, "Bevestig je wachtwoord"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Wachtwoorden komen niet overeen",
    path: ["confirm"],
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  // Onherstelbare token-fouten (verlopen/gebruikt/ongeldig) tonen we als
  // blijvende state i.p.v. alleen een toast — opnieuw submitten heeft geen zin.
  const [tokenError, setTokenError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const onSubmit = async (data: ResetPasswordForm) => {
    if (!token) {
      setTokenError(t("resetPassword.errors.missingToken"));
      return;
    }
    setIsLoading(true);
    try {
      await api.post("/auth/reset-password", {
        token,
        password: data.password,
      });
      toast({
        title: t("resetPassword.success.title"),
        description: t("resetPassword.success.description"),
      });
      // Geen auto-login: alle sessies zijn server-side ingetrokken.
      router.push("/login");
    } catch (error) {
      let description = t("errors.generic");
      if (error instanceof AxiosError) {
        const code = (error.response?.data as { error?: { code?: string } })
          ?.error?.code;
        if (!error.response) {
          description = t("errors.network");
        } else if (code === "RESET_TOKEN_EXPIRED") {
          setTokenError(t("resetPassword.errors.expired"));
          return;
        } else if (code === "RESET_TOKEN_USED") {
          setTokenError(t("resetPassword.errors.used"));
          return;
        } else if (code === "INVALID_RESET_TOKEN") {
          setTokenError(t("resetPassword.errors.invalid"));
          return;
        } else if (error.response.status === 429) {
          description = t("resetPassword.errors.tooManyAttempts");
        } else if (error.response.status >= 500) {
          description = t("errors.server");
        }
      }
      toast({
        variant: "destructive",
        title: t("resetPassword.errors.title"),
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
            <LockKeyhole className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
        </div>
        <div>
          <CardTitle className="text-2xl font-bold">
            {t("resetPassword.title")}
          </CardTitle>
          <CardDescription className="mt-1 text-base">
            {t("resetPassword.subtitle")}
          </CardDescription>
        </div>
      </CardHeader>

      {tokenError ? (
        <>
          <CardContent>
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-4"
              role="alert"
            >
              <p className="text-sm text-destructive">{tokenError}</p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 pt-2">
            <Button
              asChild
              className="w-full h-11 text-base font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-200/50 border-0"
            >
              <Link href="/forgot-password">
                {t("resetPassword.requestNewLink")}
              </Link>
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {t("resetPassword.backToLoginPrompt")}{" "}
              <Link
                href="/login"
                className="text-primary font-medium hover:underline"
              >
                {t("resetPassword.backToLogin")}
              </Link>
            </p>
          </CardFooter>
        </>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">
                {t("resetPassword.passwordLabel")}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder={t("resetPassword.passwordPlaceholder")}
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

            <div className="space-y-2">
              <Label htmlFor="confirm">
                {t("resetPassword.confirmLabel")}
              </Label>
              <Input
                id="confirm"
                type="password"
                placeholder={t("resetPassword.passwordPlaceholder")}
                autoComplete="new-password"
                {...register("confirm")}
                className={errors.confirm ? "border-destructive" : ""}
              />
              {errors.confirm && (
                <p className="text-sm text-destructive">
                  {errors.confirm.message}
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
              {t("resetPassword.submit")}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {t("resetPassword.backToLoginPrompt")}{" "}
              <Link
                href="/login"
                className="text-primary font-medium hover:underline"
              >
                {t("resetPassword.backToLogin")}
              </Link>
            </p>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
