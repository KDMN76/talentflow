"use client";

/**
 * Reports list page (Sprint Q3.5).
 *
 * Tabs: Mijn rapporten · Templates · Gedeeld
 * Per card: name, description, template-key badge, last_run_at, action menu.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Eye,
  Pencil,
  Copy,
  Trash2,
  Link as LinkIcon,
  AlertCircle,
  Sparkles,
  FileBarChart,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useCreateReport,
  useDeleteReport,
  useDuplicateReport,
  useGenerateEmbedToken,
  useReports,
  useReportTemplates,
  useRevokeEmbedToken,
} from "@/hooks/useReports";
import { TEMPLATE_LABELS, type Report, type SystemTemplate } from "@/lib/types/reports";
import { formatRelativeDate } from "@/lib/utils";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReportsListPage() {
  const router = useRouter();
  const { data: reports, isLoading } = useReports();
  const { data: templates } = useReportTemplates();
  const createReport = useCreateReport();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const myReports = (reports ?? []).filter((r) => !r.is_shared);
  const sharedReports = (reports ?? []).filter((r) => r.is_shared);

  const handleCreateBlank = async () => {
    const name = newName.trim() || "Nieuw rapport";
    try {
      const r = await createReport.mutateAsync({
        name,
        config: {
          date_range: { preset: "last_30_days" },
          blocks: [],
        },
      });
      setCreateOpen(false);
      setNewName("");
      router.push(`/reports/builder/${r.id}`);
    } catch {
      toast({ title: "Aanmaken mislukt", variant: "destructive" });
    }
  };

  const handleStartFromTemplate = async (tpl: SystemTemplate) => {
    try {
      const r = await createReport.mutateAsync({
        name: tpl.name,
        description: tpl.description,
        template_key: tpl.key,
        config: tpl.config,
      });
      setCreateOpen(false);
      router.push(`/reports/builder/${r.id}`);
    } catch {
      toast({ title: "Aanmaken mislukt", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Rapporten"
        description="Bouw aangepaste rapporten met KPI's, tabellen en grafieken."
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            <Plus className="h-4 w-4" />
            Nieuw rapport
          </Button>
        }
      />

      <Tabs defaultValue="mine" className="space-y-5">
        <TabsList className="bg-zinc-100/80 dark:bg-zinc-800/60 border border-border h-10">
          <TabsTrigger value="mine" className="px-5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Mijn rapporten
          </TabsTrigger>
          <TabsTrigger value="templates" className="px-5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Templates
          </TabsTrigger>
          <TabsTrigger value="shared" className="px-5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Gedeeld
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine">
          <ReportsGrid reports={myReports} loading={isLoading} emptyHint="Klik 'Nieuw rapport' om te starten." />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesGrid
            templates={templates}
            onPick={(tpl) => handleStartFromTemplate(tpl)}
          />
        </TabsContent>
        <TabsContent value="shared">
          <ReportsGrid reports={sharedReports} loading={isLoading} emptyHint="Geen gedeelde rapporten." />
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nieuw rapport</DialogTitle>
            <DialogDescription>
              Geef een naam op of start direct vanuit een template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-report-name">Naam</Label>
            <Input
              id="new-report-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Bijv. Q3 Executive Briefing"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleCreateBlank}
              disabled={createReport.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
            >
              <FileBarChart className="mr-2 h-4 w-4" />
              Lege builder openen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reports grid ────────────────────────────────────────────────────────────

function ReportsGrid({
  reports,
  loading,
  emptyHint,
}: {
  reports: Report[];
  loading: boolean;
  emptyHint: string;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
          <FileBarChart className="h-6 w-6 text-indigo-600" />
        </div>
        <p className="text-base font-semibold">Nog geen rapporten</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((r) => (
        <ReportCard key={r.id} report={r} />
      ))}
    </div>
  );
}

// ─── Report card ─────────────────────────────────────────────────────────────

function ReportCard({ report }: { report: Report }) {
  const router = useRouter();
  const { toast } = useToast();
  const deleteReport = useDeleteReport();
  const dupReport = useDuplicateReport();
  const generateEmbed = useGenerateEmbedToken();
  const revokeEmbed = useRevokeEmbedToken();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  const handleDelete = () => {
    deleteReport.mutate(report.id, {
      onSuccess: () => {
        toast({ title: "Rapport verwijderd" });
        setConfirmDelete(false);
      },
    });
  };

  const handleDuplicate = () => {
    dupReport.mutate(
      { id: report.id, new_name: `${report.name} (kopie)` },
      {
        onSuccess: () => toast({ title: "Rapport gedupliceerd" }),
      }
    );
  };

  const handleEmbed = async () => {
    if (report.embed_enabled && report.embed_token) {
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}/embed/reports/${report.embed_token}`
          : `/embed/reports/${report.embed_token}`;
      setEmbedUrl(url);
      setEmbedOpen(true);
      return;
    }
    try {
      const res = await generateEmbed.mutateAsync(report.id);
      setEmbedUrl(res.url);
      setEmbedOpen(true);
    } catch {
      toast({ title: "Embed-link aanmaken mislukt", variant: "destructive" });
    }
  };

  const handleRevoke = async () => {
    try {
      await revokeEmbed.mutateAsync(report.id);
      toast({ title: "Embed-link ingetrokken" });
      setEmbedOpen(false);
    } catch {
      toast({ title: "Intrekken mislukt", variant: "destructive" });
    }
  };

  const blockCount = report.config?.blocks?.length ?? 0;

  return (
    <>
      <Card className="group overflow-hidden border shadow-sm hover:shadow-md transition-all">
        <CardContent className="p-0">
          <div
            className="cursor-pointer p-5"
            onClick={() => router.push(`/reports/builder/${report.id}`)}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="line-clamp-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {report.name}
              </p>
              {report.template_key && (
                <Badge variant="info" className="shrink-0">
                  {TEMPLATE_LABELS[report.template_key]}
                </Badge>
              )}
            </div>
            <p className="line-clamp-2 min-h-[40px] text-xs text-muted-foreground">
              {report.description ?? "Geen beschrijving"}
            </p>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileBarChart className="h-3 w-3" />
                {blockCount} {blockCount === 1 ? "blok" : "blokken"}
              </span>
              {report.last_run_at && (
                <span>
                  Laatst uitgevoerd: {formatRelativeDate(report.last_run_at)}
                </span>
              )}
              {!report.last_run_at && (
                <span>Nog niet uitgevoerd</span>
              )}
              {report.embed_enabled && (
                <Badge variant="success" className="ml-auto">
                  Live embed
                </Badge>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 border-t border-zinc-100 bg-zinc-50/40 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              title="Bekijk rapport"
            >
              <Link href={`/reports/builder/${report.id}?view=run`}>
                <Eye className="mr-1 h-3.5 w-3.5" />
                Bekijk
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              title="Bewerk"
            >
              <Link href={`/reports/builder/${report.id}`}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Bewerk
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={handleDuplicate}
              title="Dupliceer"
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              Dupliceer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={handleEmbed}
              title="Embed-link"
            >
              <LinkIcon className="mr-1 h-3.5 w-3.5" />
              Embed
            </Button>
            <span className="ml-auto" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => setConfirmDelete(true)}
              title="Verwijder"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirm delete */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rapport verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{report.name}&rdquo; wordt permanent verwijderd. Embed-links
              worden ingetrokken.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Verwijder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Embed dialog */}
      <Dialog open={embedOpen} onOpenChange={setEmbedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Embed-link</DialogTitle>
            <DialogDescription>
              Iedereen met deze link kan dit rapport bekijken (read-only,
              zonder login).
            </DialogDescription>
          </DialogHeader>
          {embedUrl && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900">
                <LinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <code className="flex-1 truncate font-mono">{embedUrl}</code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      navigator.clipboard.writeText(embedUrl);
                      toast({ title: "Gekopieerd" });
                    }
                  }}
                >
                  Kopieer
                </Button>
              </div>
              <div className="flex items-center gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Iedereen met deze link kan de cijfers zien. Trek hem in
                wanneer je deze niet meer wilt delen.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmbedOpen(false)}>
              Sluit
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revokeEmbed.isPending}
            >
              Trek link in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Templates grid ──────────────────────────────────────────────────────────

function TemplatesGrid({
  templates,
  onPick,
}: {
  templates: SystemTemplate[] | undefined;
  onPick: (tpl: SystemTemplate) => void;
}) {
  if (!templates) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((tpl) => (
        <Card
          key={tpl.key}
          className="group cursor-pointer border shadow-sm hover:shadow-md transition-all"
          onClick={() => onPick(tpl)}
        >
          <CardContent className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                <Sparkles className="h-4.5 w-4.5" />
              </span>
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                {tpl.name}
              </p>
            </div>
            <p className="mb-3 line-clamp-2 text-xs text-muted-foreground">
              {tpl.description}
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {tpl.config.blocks.length} blokken
              </Badge>
              <span className="ml-auto text-[11px] font-medium text-indigo-600 group-hover:underline">
                Gebruik template →
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
