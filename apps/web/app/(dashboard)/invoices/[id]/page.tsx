"use client";

/**
 * Sprint Q4.4 — Factuur detail.
 *
 * Header + line-items + acties: Versturen / Markeer betaald / Voiden /
 * Sync naar boekhouding / Download PDF.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle2,
  UploadCloud,
  Download,
  Hash,
  Loader2,
  Send,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  downloadInvoicePdf,
  useInvoice,
  useIssueInvoice,
  useMarkInvoicePaid,
  useSyncInvoiceAccounting,
  useVoidInvoice,
} from "@/hooks/useBackOffice";
import type { InvoiceStatus } from "@/lib/types/backOffice";

const STATUS_PILL: Record<InvoiceStatus, { cls: string }> = {
  draft: {
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  sent: {
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  paid: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  overdue: {
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  void: {
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
  }).format(amount);
}

export default function InvoiceDetailPage() {
  const { t } = useTranslation("invoices");
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();

  const { data: invoice, isLoading } = useInvoice(id);

  const issue = useIssueInvoice();
  const markPaid = useMarkInvoicePaid();
  const voidMut = useVoidInvoice();
  const sync = useSyncInvoiceAccounting();

  const [paidOpen, setPaidOpen] = useState(false);
  const [paidDate, setPaidDate] = useState("");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!invoice) {
    return (
      <div className="space-y-4">
        <Link href="/invoices">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("detail.back")}
          </Button>
        </Link>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("detail.notFound")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const pill = STATUS_PILL[invoice.status];
  const canIssue = invoice.status === "draft";
  const canPay = invoice.status === "sent" || invoice.status === "overdue";
  const canVoid = invoice.status !== "paid" && invoice.status !== "void";
  const canSync =
    invoice.status !== "void" && !invoice.external_accounting_provider;

  const handleIssue = async () => {
    try {
      await issue.mutateAsync(invoice.id);
      toast({
        title: "Factuur verstuurd",
        description: `${invoice.invoice_number} is naar ${invoice.client_name} gemaild.`,
      });
    } catch {
      toast({ title: "Versturen mislukt", variant: "destructive" });
    }
  };

  const handleMarkPaid = async () => {
    if (!paidDate) return;
    try {
      await markPaid.mutateAsync({ id: invoice.id, paid_date: paidDate });
      toast({
        title: "Gemarkeerd als betaald",
        description: `Betaaldatum vastgelegd op ${formatDate(paidDate)}.`,
      });
      setPaidOpen(false);
    } catch {
      toast({ title: "Bijwerken mislukt", variant: "destructive" });
    }
  };

  const handleVoid = async () => {
    if (!voidReason.trim()) return;
    try {
      await voidMut.mutateAsync({ id: invoice.id, reason: voidReason });
      toast({
        title: "Factuur geannuleerd",
        description: "Reden vastgelegd in audit-trail.",
      });
      setVoidOpen(false);
    } catch {
      toast({ title: "Voiden mislukt", variant: "destructive" });
    }
  };

  const handleSync = async () => {
    try {
      const updated = await sync.mutateAsync(invoice.id);
      toast({
        title: "Gesynchroniseerd",
        description: `Geboekt in ${updated.external_accounting_provider} als ${updated.external_accounting_id}.`,
      });
    } catch {
      toast({
        title: "Sync mislukt",
        description: "Controleer de boekhoud-koppeling.",
        variant: "destructive",
      });
    }
  };

  const handlePdf = async () => {
    try {
      const blob = await downloadInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF gedownload" });
    } catch {
      toast({ title: "Download mislukt", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/invoices")}
        className="-ml-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Terug naar facturen
      </Button>

      <PageHeader
        title={invoice.invoice_number}
        description={`${invoice.client_name ?? "—"} · ${formatDate(invoice.period_start)} t/m ${formatDate(invoice.period_end)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={pill.cls}>{t(`status.${invoice.status}`)}</Badge>
            <Button variant="outline" size="sm" onClick={handlePdf}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              PDF
            </Button>
            {canSync && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={sync.isPending}
              >
                {sync.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UploadCloud className="mr-1.5 h-3.5 w-3.5" />
                )}
                Sync naar boekhouding
              </Button>
            )}
            {canVoid && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVoidOpen(true)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Voiden
              </Button>
            )}
            {canPay && (
              <Button
                size="sm"
                onClick={() => {
                  setPaidDate(new Date().toISOString().slice(0, 10));
                  setPaidOpen(true);
                }}
                className="border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Markeer betaald
              </Button>
            )}
            {canIssue && (
              <Button
                size="sm"
                onClick={handleIssue}
                disabled={issue.isPending}
                className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
              >
                {issue.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                Versturen
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main */}
        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-6 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                icon={<Hash className="h-3.5 w-3.5" />}
                label="Factuurnummer"
                value={invoice.invoice_number}
                mono
              />
              <Field
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Klant"
                value={invoice.client_name ?? "—"}
              />
              <Field
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Factuurdatum"
                value={formatDate(invoice.issued_date)}
              />
              <Field
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Vervaldatum"
                value={formatDate(invoice.due_date)}
              />
              <Field
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Periode start"
                value={formatDate(invoice.period_start)}
              />
              <Field
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Periode eind"
                value={formatDate(invoice.period_end)}
              />
              {invoice.paid_date && (
                <Field
                  icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                  label="Betaald op"
                  value={formatDate(invoice.paid_date)}
                />
              )}
              {invoice.contract_id && (
                <Field
                  icon={<Hash className="h-3.5 w-3.5" />}
                  label="Contract"
                  value={invoice.contract_id}
                  link={`/contracts/${invoice.contract_id}`}
                />
              )}
            </div>

            {/* Lines */}
            <div className="rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-2.5">Omschrijving</th>
                    <th className="px-4 py-2.5 text-right">Aantal</th>
                    <th className="px-4 py-2.5 text-right">Eenheid</th>
                    <th className="px-4 py-2.5 text-right">Prijs</th>
                    <th className="px-4 py-2.5 text-right">Totaal</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.lines ?? []).map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                        {l.description}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {l.quantity}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {l.unit}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatMoney(l.unit_price, invoice.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                        {formatMoney(l.line_total, invoice.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="ml-auto max-w-xs space-y-2 text-sm">
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>Subtotaal</span>
                <span className="tabular-nums">
                  {formatMoney(invoice.subtotal_amount, invoice.currency)}
                </span>
              </div>
              <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <span>BTW ({invoice.vat_rate}%)</span>
                <span className="tabular-nums">
                  {formatMoney(invoice.vat_amount, invoice.currency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-bold text-zinc-900 dark:text-zinc-100">
                <span>Totaal</span>
                <span className="tabular-nums">
                  {formatMoney(invoice.total_amount, invoice.currency)}
                </span>
              </div>
            </div>

            {invoice.notes && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
                <p className="font-semibold">Notitie</p>
                <p className="mt-0.5">{invoice.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Boekhouding
              </p>
              {invoice.external_accounting_provider ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">
                      Gesynchroniseerd ·{" "}
                      {invoice.external_accounting_provider.replace(
                        "_",
                        " "
                      )}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {invoice.external_accounting_id}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Laatste sync: {formatDate(invoice.external_synced_at)}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Nog niet gesynchroniseerd.
                  </p>
                  <Button
                    onClick={handleSync}
                    disabled={sync.isPending}
                    size="sm"
                    variant="outline"
                    className="w-full"
                  >
                    {sync.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UploadCloud className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Sync nu
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* MARK PAID DIALOG */}
      <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Markeer als betaald</DialogTitle>
            <DialogDescription>
              Vul de daadwerkelijke betaaldatum in. Dit wordt vastgelegd in de
              audit-trail.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="paid-date">Betaaldatum</Label>
            <Input
              id="paid-date"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaidOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleMarkPaid}
              disabled={!paidDate || markPaid.isPending}
              className="border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            >
              {markPaid.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Bevestig betaling
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VOID DIALOG */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Factuur voiden
            </DialogTitle>
            <DialogDescription>
              Voiden is permanent. Een nieuwe factuur kan worden gegenereerd met
              correcte gegevens.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="void-reason">Reden</Label>
            <Textarea
              id="void-reason"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Bv. dubbele factuur, onjuiste periode"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleVoid}
              disabled={!voidReason.trim() || voidMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {voidMut.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Void factuur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
  mono,
  link,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  link?: string;
}) {
  const valueEl = link ? (
    <Link
      href={link}
      className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
    >
      {value}
    </Link>
  ) : (
    <span
      className={
        mono
          ? "font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100"
          : "text-sm font-medium text-zinc-900 dark:text-zinc-100"
      }
    >
      {value}
    </span>
  );
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-0.5">{valueEl}</p>
    </div>
  );
}
