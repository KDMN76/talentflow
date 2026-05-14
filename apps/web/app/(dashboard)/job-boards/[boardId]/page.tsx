"use client";

/**
 * Sprint Q4.3 — Per-board connect / manage page.
 *
 * - When NOT connected: renders an auth-type-specific connection form.
 * - When connected: shows status, last-poll, last-error, disconnect with
 *   confirmation, and a "Test posting" section that posts a single job to
 *   this board only (uses POST /postings with one board_id).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  MapPin,
  Plug,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useConnectJobBoard,
  useCreatePostings,
  useDisconnectJobBoard,
  useJobBoardCatalog,
  useJobBoardIntegrations,
  useJobPostings,
} from "@/hooks/useJobBoards";
import { useJobs } from "@/hooks/useJobs";
import type { JobBoardRegion } from "@/lib/types/jobBoards";

const REGION_LABEL: Record<JobBoardRegion, string> = {
  global: "Global",
  nl: "NL",
  de: "DE",
  eu: "EU",
};

function brandInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function JobBoardConnectPage() {
  const router = useRouter();
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId;
  const { toast } = useToast();

  const { data: catalog, isLoading: catalogLoading } = useJobBoardCatalog();
  const { data: integrations } = useJobBoardIntegrations();
  const { data: jobs } = useJobs("open");
  const { data: postings } = useJobPostings({ status: undefined });

  const connect = useConnectJobBoard();
  const disconnect = useDisconnectJobBoard();
  const createPostings = useCreatePostings();

  const board = useMemo(
    () => (catalog ?? []).find((b) => b.id === boardId),
    [catalog, boardId]
  );
  const integration = useMemo(
    () => (integrations ?? []).find((i) => i.board_id === boardId) ?? null,
    [integrations, boardId]
  );

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");

  // Form state for the various auth-types
  const [apiKey, setApiKey] = useState("");
  const [apiDisplayName, setApiDisplayName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");

  const tenantSlug = "tenant-demo";
  const generatedFeedUrl = `https://app.talentflow.io/api/public/job-feeds/${tenantSlug}/${boardId}.xml`;

  const ownPostings = useMemo(
    () => (postings ?? []).filter((p) => p.board_id === boardId),
    [postings, boardId]
  );

  if (catalogLoading) {
    return (
      <div className="space-y-4 p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="space-y-4">
        <Link href="/job-boards">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Terug
          </Button>
        </Link>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Vacaturebank niet gevonden.
          </CardContent>
        </Card>
      </div>
    );
  }

  const connected = integration?.status === "connected";

  const handleConnect = async (payload: Record<string, unknown>) => {
    try {
      await connect.mutateAsync({ boardId, payload });
      toast({
        title: "Verbinding gemaakt",
        description: `${board.display_name} is nu actief.`,
      });
    } catch {
      toast({
        title: "Verbinden mislukt",
        description: "Probeer het opnieuw of controleer de gegevens.",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync(boardId);
      toast({
        title: "Verbinding losgekoppeld",
        description: `${board.display_name} is uitgeschakeld.`,
      });
      setConfirmDisconnect(false);
    } catch {
      toast({
        title: "Loskoppelen mislukt",
        variant: "destructive",
      });
    }
  };

  const handleTestPosting = async () => {
    if (!selectedJobId) return;
    const job = jobs?.find((j) => j.id === selectedJobId);
    try {
      await createPostings.mutateAsync({
        job_id: selectedJobId,
        job_title: job?.title,
        board_ids: [boardId],
      });
      toast({
        title: "Test-plaatsing aangemaakt",
        description: `${job?.title ?? "Vacature"} staat in de wachtrij voor ${board.display_name}.`,
      });
    } catch {
      toast({ title: "Plaatsen mislukt", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/job-boards")}
        className="-ml-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Terug naar overzicht
      </Button>

      <PageHeader
        title={board.display_name}
        description={
          connected
            ? "Beheer deze koppeling, bekijk status en test plaatsingen."
            : "Verbind deze vacaturebank om vacatures direct te kunnen distribueren."
        }
      />

      {/* Board summary header */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-base font-bold text-white shadow-md">
              {brandInitials(board.display_name)}
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {board.display_name}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {REGION_LABEL[board.region]}
                </span>
                <span>·</span>
                <span className="capitalize">
                  {board.auth_type.replace("_", " ")}
                </span>
              </div>
            </div>
          </div>
          {connected ? (
            <Badge className="border-0 bg-emerald-100 px-3 py-1 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Verbonden
            </Badge>
          ) : (
            <Badge className="border-0 bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Niet verbonden
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Connection state */}
      {!connected ? (
        <ConnectionForm
          authType={board.auth_type}
          isPending={connect.isPending}
          apiKey={apiKey}
          setApiKey={setApiKey}
          apiDisplayName={apiDisplayName}
          setApiDisplayName={setApiDisplayName}
          feedUrl={feedUrl}
          setFeedUrl={setFeedUrl}
          generatedFeedUrl={generatedFeedUrl}
          onConnect={handleConnect}
        />
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat
                label="Verbonden sinds"
                value={formatDateTime(integration?.connected_at ?? null)}
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              />
              <Stat
                label="Laatste poll"
                value={formatDateTime(integration?.last_polled_at ?? null)}
                icon={<Clock className="h-4 w-4 text-indigo-500" />}
              />
            </div>

            {integration?.last_error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{integration.last_error}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Koppeling werkt — geen recente fouten gerapporteerd.</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                variant="outline"
                onClick={() => setConfirmDisconnect(true)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Loskoppelen
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test posting */}
      {connected && (
        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Test-plaatsing
              </p>
              <p className="text-xs text-muted-foreground">
                Plaats één vacature op deze board om de koppeling te valideren.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="test-job">Vacature</Label>
                <Select
                  value={selectedJobId}
                  onValueChange={setSelectedJobId}
                  disabled={!jobs || jobs.length === 0}
                >
                  <SelectTrigger id="test-job">
                    <SelectValue placeholder="Kies een open vacature..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.title}
                        {j.location ? ` — ${j.location}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleTestPosting}
                disabled={!selectedJobId || createPostings.isPending}
                className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
              >
                {createPostings.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" />
                )}
                Plaatsen
              </Button>
            </div>

            {ownPostings.length > 0 && (
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Recente plaatsingen op {board.display_name}
                </p>
                <ul className="space-y-1.5">
                  {ownPostings.slice(0, 5).map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-zinc-50/60 px-3 py-2 text-xs dark:bg-zinc-800/30"
                    >
                      <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                        {p.job_title ?? p.job_id}
                      </span>
                      <span className="capitalize text-muted-foreground">
                        {p.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verbinding loskoppelen?</AlertDialogTitle>
            <AlertDialogDescription>
              Lopende plaatsingen op {board.display_name} blijven actief tot ze
              verlopen, maar er kunnen geen nieuwe plaatsingen meer worden
              gedaan tot je opnieuw verbindt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnect.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Loskoppelen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}

interface ConnectionFormProps {
  authType: "oauth2" | "api_key" | "xml_feed" | "none";
  isPending: boolean;
  apiKey: string;
  setApiKey: (v: string) => void;
  apiDisplayName: string;
  setApiDisplayName: (v: string) => void;
  feedUrl: string;
  setFeedUrl: (v: string) => void;
  generatedFeedUrl: string;
  onConnect: (payload: Record<string, unknown>) => void;
}

function ConnectionForm(props: ConnectionFormProps) {
  const {
    authType,
    isPending,
    apiKey,
    setApiKey,
    apiDisplayName,
    setApiDisplayName,
    feedUrl,
    setFeedUrl,
    generatedFeedUrl,
    onConnect,
  } = props;
  const { toast } = useToast();

  if (authType === "oauth2") {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-5 p-6">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Verbinden via OAuth
            </p>
            <p className="text-xs text-muted-foreground">
              Je wordt doorgestuurd naar de provider om toestemming te geven.
              Wij slaan alleen tokens op die nodig zijn om vacatures te plaatsen.
            </p>
          </div>
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <ul className="space-y-1 text-indigo-800 dark:text-indigo-300">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Lees-/schrijfrechten beperkt tot vacatureplaatsing.
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Tokens worden versleuteld opgeslagen.
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Eén klik om weer los te koppelen.
              </li>
            </ul>
          </div>
          <Button
            onClick={() => onConnect({ oauth: "mock-handshake-success" })}
            disabled={isPending}
            className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plug className="mr-1.5 h-4 w-4" />
            )}
            Start OAuth
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (authType === "api_key") {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-5 p-6">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Verbinden via API-key
            </p>
            <p className="text-xs text-muted-foreground">
              Plak je partner-API-key. Sleutels worden server-side versleuteld.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="api-display-name">Account-naam (intern)</Label>
            <Input
              id="api-display-name"
              value={apiDisplayName}
              onChange={(e) => setApiDisplayName(e.target.value)}
              placeholder="Bv. TalentFlow Demo BV"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="api-key">API-key</Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_..."
                className="pl-9 font-mono text-xs"
              />
            </div>
          </div>
          <Button
            onClick={() =>
              onConnect({ api_key: apiKey, display_name: apiDisplayName })
            }
            disabled={isPending || !apiKey || !apiDisplayName}
            className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plug className="mr-1.5 h-4 w-4" />
            )}
            Verbinden
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (authType === "xml_feed") {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-5 p-6">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Verbinden via XML-feed
            </p>
            <p className="text-xs text-muted-foreground">
              Genereer een unieke feed-URL en geef die door aan de provider.
              Vacatures worden automatisch gesynchroniseerd zodra de provider
              de feed indexeert.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feed-url">Feed-URL</Label>
            <div className="flex gap-2">
              <Input
                id="feed-url"
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://app.talentflow.io/api/public/job-feeds/..."
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFeedUrl(generatedFeedUrl)}
                className="shrink-0"
              >
                <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                Genereer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(
                    feedUrl || generatedFeedUrl
                  );
                  toast({ title: "Feed-URL gekopieerd" });
                }}
                className="shrink-0"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tip: gebruik de gegenereerde URL als startpunt en deel hem met de
              provider via hun back-office.
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
            <p className="flex items-start gap-1.5">
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sommige providers verifiëren feeds asynchroon — verwacht een
              vertraging van 4–24u tot vacatures zichtbaar zijn.
            </p>
          </div>

          <Button
            onClick={() => onConnect({ feed_url: feedUrl || generatedFeedUrl })}
            disabled={isPending}
            className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plug className="mr-1.5 h-4 w-4" />
            )}
            Verbinden
          </Button>
        </CardContent>
      </Card>
    );
  }

  // auth_type === "none"
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-4 p-6">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Geen authenticatie nodig — klik om te activeren.
        </p>
        <Button
          onClick={() => onConnect({})}
          disabled={isPending}
          className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Settings2 className="mr-1.5 h-4 w-4" />
          )}
          Activeren
        </Button>
      </CardContent>
    </Card>
  );
}
