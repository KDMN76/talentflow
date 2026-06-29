"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Plus,
  Copy,
  Trash2,
  Loader2,
  Check,
  Calendar,
  Eye,
  Link2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useJobs } from "@/hooks/useJobs";
import {
  usePortalLinks,
  useCreatePortalLink,
  useDeletePortalLink,
  type PortalLinkPermissions,
} from "@/hooks/usePortalLinks";
import { formatDate, formatRelativeDate } from "@/lib/utils";

const PERMISSION_KEYS: Array<keyof PortalLinkPermissions> = [
  "view_candidates",
  "view_resumes",
  "view_ai_scores",
  "view_contact_info",
  "accept_reject",
  "comment",
  "download_cv",
  "view_pipeline_history",
];

const PERMISSION_COLORS: Record<keyof PortalLinkPermissions, string> = {
  view_candidates: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  view_resumes: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  view_ai_scores: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400",
  view_contact_info: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  accept_reject: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  comment: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  download_cv: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  view_pipeline_history: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export default function PortalLinksPage() {
  const { t } = useTranslation("miscPortals");
  const { toast } = useToast();
  const { data: portalLinks, isLoading } = usePortalLinks();
  const { data: jobs } = useJobs();
  const createPortalLink = useCreatePortalLink();
  const deletePortalLink = useDeletePortalLink();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  // Form state
  const [selectedJobId, setSelectedJobId] = useState("");
  const [clientName, setClientName] = useState("");
  const [permissions, setPermissions] = useState<PortalLinkPermissions>({
    view_candidates: true,
    view_resumes: true,
    view_ai_scores: true,
    view_contact_info: true,
    accept_reject: true,
    comment: true,
    download_cv: false,
    view_pipeline_history: false,
  });
  const [expiresAt, setExpiresAt] = useState("");

  const resetForm = () => {
    setSelectedJobId("");
    setClientName("");
    setPermissions({
      view_candidates: true,
      view_resumes: true,
      view_ai_scores: true,
      view_contact_info: true,
      accept_reject: true,
      comment: true,
      download_cv: false,
      view_pipeline_history: false,
    });
    setExpiresAt("");
  };

  const handleCreate = async () => {
    if (!selectedJobId) {
      toast({
        title: t("portalList.toasts.jobRequiredTitle"),
        description: t("portalList.toasts.jobRequiredDescription"),
        variant: "destructive",
      });
      return;
    }
    try {
      const result = await createPortalLink.mutateAsync({
        job_id: selectedJobId,
        client_name: clientName,
        permissions,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setIsCreateOpen(false);
      setCreatedToken(result.token);
      resetForm();
      toast({
        title: t("portalList.toasts.createdTitle"),
        description: t("portalList.toasts.createdDescription"),
      });
    } catch {
      toast({
        title: t("portalList.toasts.errorTitle"),
        description: t("portalList.toasts.errorDescription"),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    await deletePortalLink.mutateAsync(id);
    toast({ title: t("portalList.toasts.deletedTitle") });
  };

  const buildUrl = (token: string) => {
    if (typeof window === "undefined") return `/portal/${token}`;
    return `${window.location.origin}/portal/${token}`;
  };

  const handleCopy = (token: string) => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(buildUrl(token));
      toast({
        title: t("portalList.toasts.copiedTitle"),
        description: t("portalList.toasts.copiedDescription"),
      });
    }
  };

  const togglePermission = (key: keyof PortalLinkPermissions) => {
    if (key === "view_candidates") return; // always true — base permission
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <PageHeader
        title={t("portalList.header.title")}
        description={t("portalList.header.description")}
        actions={
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("portalList.header.newLink")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="h-20 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !portalLinks || portalLinks.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg mb-4">
              <Globe className="h-7 w-7 text-white" />
            </div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("portalList.empty.title")}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground text-center max-w-sm">
              {t("portalList.empty.description")}
            </p>
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="mt-5 bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("portalList.empty.newLink")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {portalLinks.map((link) => {
            const enabledPerms = (
              Object.keys(link.permissions) as Array<keyof PortalLinkPermissions>
            ).filter((k) => link.permissions[k]);
            return (
              <Card
                key={link.id}
                className="border-0 shadow-sm hover:shadow-md transition-shadow"
              >
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {link.client_name || t("portalList.card.unnamedClient")}
                        </h3>
                        {link.expires_at &&
                          new Date(link.expires_at) < new Date() && (
                            <Badge className="bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400 border-0 text-[10px] px-1.5 py-0">
                              {t("portalList.card.expired")}
                            </Badge>
                          )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <Link2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                        {link.job_title || t("portalList.card.jobFallback")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enabledPerms.map((p) => (
                          <Badge
                            key={p}
                            variant="secondary"
                            className={`text-[10px] px-1.5 py-0 border-0 ${PERMISSION_COLORS[p]}`}
                          >
                            {t(`portalList.permissionLabels.${p}`)}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {link.expires_at
                            ? t("portalList.card.expiresOn", {
                                date: formatDate(link.expires_at),
                              })
                            : t("portalList.card.noExpiry")}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {t("portalList.card.viewCount", {
                            count: link.view_count,
                          })}
                          {link.last_viewed_at &&
                            t("portalList.card.lastViewed", {
                              date: formatRelativeDate(link.last_viewed_at),
                            })}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopy(link.token)}
                        title={t("portalList.card.copyTitle")}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        {t("portalList.card.copyLink")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(link.id)}
                        disabled={deletePortalLink.isPending}
                        className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Portal Link Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("portalList.createDialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("portalList.createDialog.jobLabel")}</Label>
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("portalList.createDialog.jobPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {jobs?.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="client-name">
                {t("portalList.createDialog.clientNameLabel")}
              </Label>
              <Input
                id="client-name"
                placeholder={t("portalList.createDialog.clientNamePlaceholder")}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("portalList.createDialog.permissionsLabel")}</Label>
              <div className="grid grid-cols-1 gap-1.5">
                {PERMISSION_KEYS.map(
                  (key) => (
                    <label
                      key={key}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 border border-transparent transition-colors ${
                        key === "view_candidates"
                          ? "opacity-70"
                          : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-indigo-600"
                        checked={permissions[key]}
                        onChange={() => togglePermission(key)}
                        disabled={key === "view_candidates"}
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {t(`portalList.permissionLabels.${key}`)}
                      </span>
                      {key === "view_candidates" && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {t("portalList.createDialog.defaultBadge")}
                        </span>
                      )}
                    </label>
                  )
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expires-at">
                {t("portalList.createDialog.expiresLabel")}
              </Label>
              <Input
                id="expires-at"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">
                {t("portalList.createDialog.cancel")}
              </Button>
            </DialogClose>
            <Button
              onClick={handleCreate}
              disabled={!selectedJobId || createPortalLink.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              {createPortalLink.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("portalList.createDialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Created link Dialog */}
      <Dialog
        open={!!createdToken}
        onOpenChange={(open) => !open && setCreatedToken(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-emerald-600" />
              {t("portalList.createdDialog.title")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 px-4 py-3">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                {t("portalList.createdDialog.intro")}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("portalList.createdDialog.linkLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={createdToken ? buildUrl(createdToken) : ""}
                  className="font-mono text-xs"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => createdToken && handleCopy(createdToken)}
                  title={t("portalList.createdDialog.copyTitle")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 border-0"
                onClick={() => setCreatedToken(null)}
              >
                {t("portalList.createdDialog.close")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
