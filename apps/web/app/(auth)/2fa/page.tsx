"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
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

/**
 * Tweede stap van de login wanneer een gebruiker 2FA aan heeft staan.
 * De login-pagina stopt het kortlevende partial_token in sessionStorage en
 * stuurt hierheen. Wij wisselen {partial_token, code} via /auth/2fa/verify in
 * voor een echt accessToken (+ refresh-cookie).
 */
export default function TwoFactorPage() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Zonder partial_token is deze pagina direct geopend (of het token is
  // verlopen tussen de stappen) — terug naar login.
  useEffect(() => {
    if (!sessionStorage.getItem("tf_partial_token")) {
      router.replace("/login");
    }
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const partialToken = sessionStorage.getItem("tf_partial_token");
    if (!partialToken) {
      router.replace("/login");
      return;
    }
    setIsLoading(true);
    try {
      const response = await api.post("/auth/2fa/verify", {
        partial_token: partialToken,
        code: code.trim(),
      });
      sessionStorage.removeItem("tf_partial_token");
      setToken(response.data.accessToken);
      router.push("/dashboard");
    } catch (error) {
      let description = t("twoFactor.errors.invalidCode");
      if (error instanceof AxiosError) {
        const apiError = (
          error.response?.data as { error?: { code?: string } }
        )?.error?.code;
        if (!error.response) {
          description = t("errors.network");
        } else if (
          apiError === "PARTIAL_TOKEN_EXPIRED" ||
          apiError === "INVALID_PARTIAL_TOKEN"
        ) {
          sessionStorage.removeItem("tf_partial_token");
          toast({
            variant: "destructive",
            title: t("twoFactor.errors.title"),
            description: t("twoFactor.errors.expired"),
          });
          router.replace("/login");
          return;
        } else if (error.response.status === 429) {
          description = t("twoFactor.errors.tooManyAttempts");
        } else if (error.response.status >= 500) {
          description = t("errors.server");
        }
      }
      toast({
        variant: "destructive",
        title: t("twoFactor.errors.title"),
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
            {t("twoFactor.title")}
          </CardTitle>
          <CardDescription className="mt-1 text-base">
            {t("twoFactor.subtitle")}
          </CardDescription>
        </div>
      </CardHeader>

      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{t("twoFactor.codeLabel")}</Label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-center text-lg tracking-[0.5em]"
            />
            <p className="text-sm text-muted-foreground">
              {t("twoFactor.backupHint")}
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4 pt-2">
          <Button
            type="submit"
            className="w-full h-11 text-base font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-200/50 border-0"
            disabled={isLoading || code.trim().length < 6}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("twoFactor.submit")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
