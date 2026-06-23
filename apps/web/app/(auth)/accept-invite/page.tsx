"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ShieldCheck } from "lucide-react";
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
import { setToken } from "@/lib/auth";
import { AxiosError } from "axios";

// useSearchParams vereist een dynamische render; opt de route uit static gen.
export const dynamic = "force-dynamic";

const acceptInviteSchema = z
  .object({
    password: z.string().min(8, "Wachtwoord moet minimaal 8 tekens bevatten"),
    confirm: z.string().min(8, "Bevestig je wachtwoord"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Wachtwoorden komen niet overeen",
    path: ["confirm"],
  });

type AcceptInviteForm = z.infer<typeof acceptInviteSchema>;

export default function AcceptInvitePage() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInviteForm>({
    resolver: zodResolver(acceptInviteSchema),
  });

  const onSubmit = async (data: AcceptInviteForm) => {
    if (!token) {
      toast({
        variant: "destructive",
        title: t("acceptInvite.errors.title"),
        description: t("acceptInvite.errors.missingToken"),
      });
      return;
    }
    setIsLoading(true);
    try {
      const response = await api.post("/auth/accept-invite", {
        token,
        password: data.password,
      });
      setToken(response.data.accessToken);
      toast({
        title: t("acceptInvite.success.title"),
        description: t("acceptInvite.success.description"),
      });
      router.push("/dashboard");
    } catch (error) {
      let description = t("errors.generic");
      if (error instanceof AxiosError) {
        const code = (error.response?.data as { error?: { code?: string } })
          ?.error?.code;
        if (!error.response) {
          description = t("errors.network");
        } else if (code === "INVITE_EXPIRED") {
          description = t("acceptInvite.errors.expired");
        } else if (code === "INVITE_ALREADY_USED") {
          description = t("acceptInvite.errors.used");
        } else if (code === "INVALID_INVITE_TOKEN") {
          description = t("acceptInvite.errors.invalid");
        } else if (error.response.status === 429) {
          description = t("acceptInvite.errors.tooManyAttempts");
        } else if (error.response.status >= 500) {
          description = t("errors.server");
        }
      }
      toast({
        variant: "destructive",
        title: t("acceptInvite.errors.title"),
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
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
        </div>
        <div>
          <CardTitle className="text-2xl font-bold">
            {t("acceptInvite.title")}
          </CardTitle>
          <CardDescription className="mt-1 text-base">
            {t("acceptInvite.subtitle")}
          </CardDescription>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{t("acceptInvite.passwordLabel")}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t("acceptInvite.passwordPlaceholder")}
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
            <Label htmlFor="confirm">{t("acceptInvite.confirmLabel")}</Label>
            <Input
              id="confirm"
              type="password"
              placeholder={t("acceptInvite.passwordPlaceholder")}
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
            {t("acceptInvite.submit")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
