/**
 * PortalStateScreens — vriendelijke state-screens voor het klantportaal.
 *
 * - PortalSkeleton: skeleton-cards tijdens initial load
 * - PortalErrorScreen: invalid (404) / expired (410) / ratelimited (429) /
 *   network-error met optionele retry. Teksten via i18n (portalPublic),
 *   dus NL én EN afhankelijk van de browser-taal van de gast.
 */

"use client";

import { AlertCircle, Clock, Hourglass, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PortalSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export type PortalErrorVariant = "invalid" | "expired" | "ratelimited" | "network";

/** Map een HTTP-status van de portal-API naar een error-variant. */
export function portalErrorVariantFromStatus(
  status: number | undefined
): PortalErrorVariant {
  if (status === 404) return "invalid";
  if (status === 410) return "expired";
  if (status === 429) return "ratelimited";
  return "network";
}

const VARIANT_META: Record<
  PortalErrorVariant,
  {
    titleKey: string;
    bodyKey: string;
    icon: React.ComponentType<{ className?: string }>;
    iconCls: string;
    bgCls: string;
    retryable: boolean;
  }
> = {
  invalid: {
    titleKey: "states.invalidTitle",
    bodyKey: "states.invalidBody",
    icon: AlertCircle,
    iconCls: "text-red-600 dark:text-red-400",
    bgCls: "bg-red-100 dark:bg-red-950/30",
    retryable: false,
  },
  expired: {
    titleKey: "states.expiredTitle",
    bodyKey: "states.expiredBody",
    icon: Clock,
    iconCls: "text-amber-600 dark:text-amber-400",
    bgCls: "bg-amber-100 dark:bg-amber-950/30",
    retryable: false,
  },
  ratelimited: {
    titleKey: "states.rateLimitedTitle",
    bodyKey: "states.rateLimitedBody",
    icon: Hourglass,
    iconCls: "text-amber-600 dark:text-amber-400",
    bgCls: "bg-amber-100 dark:bg-amber-950/30",
    retryable: true,
  },
  network: {
    titleKey: "states.networkTitle",
    bodyKey: "states.networkBody",
    icon: AlertCircle,
    iconCls: "text-red-600 dark:text-red-400",
    bgCls: "bg-red-100 dark:bg-red-950/30",
    retryable: true,
  },
};

export function PortalErrorScreen({
  variant,
  onRetry,
}: {
  variant: PortalErrorVariant;
  onRetry?: () => void;
}) {
  const { t } = useTranslation("portalPublic");
  const meta = VARIANT_META[variant];
  const Icon = meta.icon;
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4 text-center">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${meta.bgCls}`}
        >
          <Icon className={`h-7 w-7 ${meta.iconCls}`} />
        </div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {t(meta.titleKey)}
        </h1>
        <p className="text-sm text-muted-foreground">{t(meta.bodyKey)}</p>
        {meta.retryable && onRetry && (
          <div className="pt-2">
            <Button onClick={onRetry} variant="outline">
              <RotateCw className="mr-1.5 h-3.5 w-3.5" />
              {t("states.retry")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
