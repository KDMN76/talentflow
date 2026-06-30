"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  RefreshCcw,
  Save,
  Settings as SettingsIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PermissionsMatrix } from "@/components/portal/PermissionsMatrix";
import { PortalActivityFeed } from "@/components/portal/PortalActivityFeed";
import {
  usePortalActivity,
  usePortalLink,
  useRotatePortalToken,
  useUpdatePortalLink,
  useVerifyCustomDomain,
  type PortalLinkPermissions,
  type PortalNotificationFrequency,
} from "@/hooks/usePortalLinks";

const PORTAL_BASE_URL =
  process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? "https://portals.talentflow.app";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PortalLinkDetailPage() {
  const { t } = useTranslation("miscPortals");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const portalId = params.id;
  const { data: portal, isLoading } = usePortalLink(portalId);
  const { data: activity } = usePortalActivity(portalId);
  const update = useUpdatePortalLink(portalId);
  const rotate = useRotatePortalToken(portalId);
  const verify = useVerifyCustomDomain();

  const [showRotateConfirm, setShowRotateConfirm] = useState(false);

  if (isLoading || !portal) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const portalUrl = portal.custom_domain
    ? `https://${portal.custom_domain}`
    : `${PORTAL_BASE_URL}/portal/${portal.token}`;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    toast({ title: t("portalDetail.toasts.copied", { label }) });
  };

  const handlePermissionsChange = (next: PortalLinkPermissions) => {
    update.mutate(
      { permissions: next },
      {
        onSuccess: () =>
          toast({ title: t("portalDetail.toasts.permissionsUpdated") }),
      }
    );
  };

  const handleNotifyEmailBlur = (value: string) => {
    if (value === (portal.notification_email ?? "")) return;
    update.mutate(
      { notification_email: value || null },
      {
        onSuccess: () =>
          toast({ title: t("portalDetail.toasts.notifyEmailUpdated") }),
      }
    );
  };

  const handleFrequencyChange = (freq: PortalNotificationFrequency) => {
    update.mutate(
      { notification_frequency: freq },
      {
        onSuccess: () =>
          toast({ title: t("portalDetail.toasts.frequencyUpdated") }),
      }
    );
  };

  const handleVerifyDomain = () => {
    if (!portal.custom_domain) return;
    verify.mutate(
      portal.custom_domain,
      {
        onSuccess: (res) => {
          if (res.verified) {
            toast({
              title: t("portalDetail.toasts.domainVerifiedTitle"),
              description: t("portalDetail.toasts.domainVerifiedDescription", {
                domain: portal.custom_domain,
              }),
            });
          } else {
            toast({
              variant: "destructive",
              title: t("portalDetail.toasts.dnsNotFoundTitle"),
              description: t("portalDetail.toasts.dnsNotFoundDescription"),
            });
          }
        },
      }
    );
  };

  const handleRotate = () => {
    rotate.mutate(undefined, {
      onSuccess: () => {
        toast({
          title: t("portalDetail.toasts.tokenRotatedTitle"),
          description: t("portalDetail.toasts.tokenRotatedDescription"),
        });
        setShowRotateConfirm(false);
      },
    });
  };

  return (
    <div className="space-y-6 p-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/portal-links")}
        className="-ml-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        {t("portalDetail.back")}
      </Button>

      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-xl">
              {portal.client_name ?? t("portalDetail.unknownClient")}
            </CardTitle>
            <CardDescription>
              {t("portalDetail.jobLabel")}{" "}
              <span className="font-medium">
                {portal.job_title ?? t("portalDetail.jobFallback")}
              </span>
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {portal.is_active ? (
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {t("portalDetail.active")}
                </Badge>
              ) : (
                <Badge variant="secondary">{t("portalDetail.disabled")}</Badge>
              )}
              {portal.custom_domain && (
                <Badge variant="outline">
                  <Globe className="mr-1 h-3 w-3" />
                  {t("portalDetail.customDomain")}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {t("portalDetail.lastActivity", {
                  date: formatDateTime(portal.last_activity_at),
                  count: portal.view_count,
                })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(portalUrl, "_blank", "noreferrer")}
            >
              {t("portalDetail.openPortal")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                handleCopy(portalUrl, t("portalDetail.toasts.portalUrlLabel"))
              }
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {t("portalDetail.copyUrl")}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="settings">
            <SettingsIcon className="mr-1 h-3.5 w-3.5" />
            {t("portalDetail.tabs.settings")}
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity className="mr-1 h-3.5 w-3.5" />
            {t("portalDetail.tabs.activity")}
            {activity && activity.length > 0 ? ` (${activity.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="domain">
            <Globe className="mr-1 h-3.5 w-3.5" />
            {t("portalDetail.tabs.domain")}
          </TabsTrigger>
          <TabsTrigger value="token">
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            {t("portalDetail.tabs.token")}
          </TabsTrigger>
        </TabsList>

        {/* Settings */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalDetail.permissions.title")}
              </CardTitle>
              <CardDescription>
                {t("portalDetail.permissions.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionsMatrix
                value={portal.permissions}
                onChange={handlePermissionsChange}
                disabled={update.isPending}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalDetail.notifications.title")}
              </CardTitle>
              <CardDescription>
                {t("portalDetail.notifications.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="notify-email">
                  {t("portalDetail.notifications.emailLabel")}
                </Label>
                <Input
                  id="notify-email"
                  type="email"
                  defaultValue={portal.notification_email ?? ""}
                  placeholder={t("portalDetail.notifications.emailPlaceholder")}
                  onBlur={(e) => handleNotifyEmailBlur(e.target.value.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("portalDetail.notifications.frequencyLabel")}</Label>
                <Select
                  value={portal.notification_frequency}
                  onValueChange={(v) =>
                    handleFrequencyChange(v as PortalNotificationFrequency)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realtime">
                      {t("portalDetail.notifications.frequency.realtime")}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t("portalDetail.notifications.frequency.daily")}
                    </SelectItem>
                    <SelectItem value="weekly">
                      {t("portalDetail.notifications.frequency.weekly")}
                    </SelectItem>
                    <SelectItem value="off">
                      {t("portalDetail.notifications.frequency.off")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalDetail.activity.title")}
              </CardTitle>
              <CardDescription>
                {t("portalDetail.activity.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PortalActivityFeed events={activity ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Custom domain */}
        <TabsContent value="domain" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalDetail.domain.title")}
              </CardTitle>
              <CardDescription>
                {t("portalDetail.domain.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-domain">
                  {t("portalDetail.domain.domainLabel")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="custom-domain"
                    placeholder={t("portalDetail.domain.domainPlaceholder")}
                    defaultValue={portal.custom_domain ?? ""}
                    onBlur={(e) => {
                      const next = e.target.value.trim() || null;
                      if (next === (portal.custom_domain ?? null)) return;
                      update.mutate(
                        { custom_domain: next },
                        {
                          onSuccess: () =>
                            toast({
                              title: t("portalDetail.toasts.domainSaved"),
                            }),
                        }
                      );
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleVerifyDomain}
                    disabled={!portal.custom_domain || verify.isPending}
                  >
                    {verify.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    {t("portalDetail.domain.verify")}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-zinc-50 p-4 text-sm dark:bg-zinc-900/40">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  {t("portalDetail.domain.statusLabel")}
                  {portal.custom_domain_status === "verified" ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {t("portalDetail.domain.status.verified")}
                    </Badge>
                  ) : portal.custom_domain_status === "pending" ? (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      {t("portalDetail.domain.status.pending")}
                    </Badge>
                  ) : portal.custom_domain_status === "failed" ? (
                    <Badge variant="destructive">
                      {t("portalDetail.domain.status.failed")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      {t("portalDetail.domain.status.none")}
                    </Badge>
                  )}
                </div>
                {portal.custom_domain_txt_record && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {t("portalDetail.domain.dnsIntro")}
                    </p>
                    <div className="grid grid-cols-1 gap-1 rounded bg-card p-3 font-mono text-xs sm:grid-cols-3">
                      <div>
                        <span className="text-muted-foreground">
                          {t("portalDetail.domain.dnsType")}
                        </span>{" "}
                        TXT
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          {t("portalDetail.domain.dnsName")}
                        </span>{" "}
                        _talentflow-verify
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          {t("portalDetail.domain.dnsValue")}
                        </span>{" "}
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() =>
                            handleCopy(
                              portal.custom_domain_txt_record!,
                              t("portalDetail.toasts.txtRecordLabel")
                            )
                          }
                        >
                          {portal.custom_domain_txt_record}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("portalDetail.domain.cnameNote")}{" "}
                      <span className="font-mono">portals.talentflow.app</span>.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Token */}
        <TabsContent value="token">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("portalDetail.token.title")}
              </CardTitle>
              <CardDescription>
                {t("portalDetail.token.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("portalDetail.token.currentUrlLabel")}</Label>
                <div className="flex gap-2">
                  <Input value={portalUrl} readOnly className="font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      handleCopy(portalUrl, t("portalDetail.toasts.urlLabel"))
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-medium">
                      {t("portalDetail.token.warningTitle")}
                    </div>
                    <p className="text-xs">
                      {t("portalDetail.token.warningBody")}
                    </p>
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => setShowRotateConfirm(true)}
                disabled={rotate.isPending}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                {t("portalDetail.token.rotate")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rotate confirmation */}
      <Dialog open={showRotateConfirm} onOpenChange={setShowRotateConfirm}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("portalDetail.rotateDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("portalDetail.rotateDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRotateConfirm(false)}
              disabled={rotate.isPending}
            >
              {t("portalDetail.rotateDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRotate}
              disabled={rotate.isPending}
            >
              {rotate.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t("portalDetail.rotateDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
