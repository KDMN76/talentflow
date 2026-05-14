"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Users,
  Target,
  Plus,
  Globe,
  Phone,
  Mail,
  Linkedin,
  ExternalLink,
  Euro,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useOrganizations,
  useCreateOrganization,
  useContacts,
  useCreateContact,
  useDealsPipeline,
  useCreateDeal,
  DEAL_STAGES,
  DEAL_STAGE_LABELS,
  type DealStage,
  type Organization,
  type CrmDeal,
} from "@/hooks/useCrm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const ORG_TYPE_LABELS: Record<Organization["type"], string> = {
  client: "Klant",
  prospect: "Prospect",
  partner: "Partner",
};

const ORG_TYPE_BADGE: Record<Organization["type"], string> = {
  client:
    "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
  prospect:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  partner:
    "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900",
};

const DEAL_STAGE_COLORS: Record<
  DealStage,
  { header: string; dot: string; ring: string }
> = {
  prospect: {
    header: "bg-zinc-50 dark:bg-zinc-900/50 border-zinc-200 dark:border-zinc-800",
    dot: "bg-zinc-400",
    ring: "ring-zinc-200 dark:ring-zinc-800",
  },
  offerte: {
    header: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900",
    dot: "bg-blue-500",
    ring: "ring-blue-200 dark:ring-blue-900",
  },
  onderhandeling: {
    header:
      "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900",
    dot: "bg-amber-500",
    ring: "ring-amber-200 dark:ring-amber-900",
  },
  gewonnen: {
    header:
      "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900",
    dot: "bg-emerald-500",
    ring: "ring-emerald-200 dark:ring-emerald-900",
  },
  verloren: {
    header: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900",
    dot: "bg-red-500",
    ring: "ring-red-200 dark:ring-red-900",
  },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CrmPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="CRM"
        description="Beheer klanten, contacten en sales-deals"
      />

      <Tabs defaultValue="organizations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organizations">
            <Building2 className="h-4 w-4 mr-2" />
            Klanten
          </TabsTrigger>
          <TabsTrigger value="contacts">
            <Users className="h-4 w-4 mr-2" />
            Contacten
          </TabsTrigger>
          <TabsTrigger value="deals">
            <Target className="h-4 w-4 mr-2" />
            Deals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organizations">
          <OrganizationsTab />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsTab />
        </TabsContent>
        <TabsContent value="deals">
          <DealsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Organizations Tab ──────────────────────────────────────────────────────

function OrganizationsTab() {
  const { data: orgs, isLoading } = useOrganizations();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!orgs) return [];
    const q = search.toLowerCase().trim();
    if (!q) return orgs;
    return orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.industry?.toLowerCase().includes(q) ||
        o.notes?.toLowerCase().includes(q)
    );
  }, [orgs, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek klanten..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-sm border-0">
              <Plus className="mr-2 h-4 w-4" />
              Nieuwe klant
            </Button>
          </DialogTrigger>
          <DialogContent>
            <CreateOrganizationDialog onClose={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12 text-muted-foreground/30" />}
          title={
            search ? "Geen klanten gevonden" : "Nog geen klanten"
          }
          description={
            search
              ? "Probeer een andere zoekterm."
              : "Voeg je eerste klant toe om te beginnen."
          }
          ctaLabel="Nieuwe klant"
          onCta={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((org) => (
            <OrganizationCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrganizationCard({ org }: { org: Organization }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card shadow-sm p-5 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {org.name}
          </h3>
          {org.industry && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">
              {org.industry}
            </p>
          )}
        </div>
        <Badge
          className={cn(
            "shrink-0 border",
            ORG_TYPE_BADGE[org.type]
          )}
        >
          {ORG_TYPE_LABELS[org.type]}
        </Badge>
      </div>

      {org.website && (
        <a
          href={org.website}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          <Globe className="h-3.5 w-3.5" />
          {org.website.replace(/^https?:\/\//, "")}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {org.notes && (
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
          {org.notes}
        </p>
      )}
    </div>
  );
}

function CreateOrganizationDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateOrganization();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [type, setType] = useState<Organization["type"]>("prospect");
  const [notes, setNotes] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({
      name: name.trim(),
      industry: industry.trim() || null,
      website: website.trim() || null,
      type,
      notes: notes.trim() || null,
    });
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Nieuwe klant</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="org-name">Naam *</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bijv. ING Bank N.V."
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-industry">Branche</Label>
          <Input
            id="org-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="Bijv. Financiële dienstverlening"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-website">Website</Label>
          <Input
            id="org-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-type">Type</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as Organization["type"])}
          >
            <SelectTrigger id="org-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="client">Klant</SelectItem>
              <SelectItem value="partner">Partner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-notes">Notities</Label>
          <textarea
            id="org-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optionele notities over deze klant..."
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuleren
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {create.isPending ? "Bezig..." : "Aanmaken"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Contacts Tab ───────────────────────────────────────────────────────────

function ContactsTab() {
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const { data: orgs } = useOrganizations();
  const { data: contacts, isLoading } = useContacts(
    orgFilter === "all" ? undefined : orgFilter
  );

  const orgById = useMemo(() => {
    const map = new Map<string, Organization>();
    for (const o of orgs ?? []) map.set(o.id, o);
    return map;
  }, [orgs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filter op organisatie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle organisaties</SelectItem>
              {(orgs ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-sm border-0">
              <Plus className="mr-2 h-4 w-4" />
              Nieuw contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <CreateContactDialog
              organizations={orgs ?? []}
              defaultOrganizationId={orgFilter === "all" ? undefined : orgFilter}
              onClose={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !contacts || contacts.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12 text-muted-foreground/30" />}
          title="Nog geen contacten"
          description="Voeg contactpersonen toe binnen je klantorganisaties."
          ctaLabel="Nieuw contact"
          onCta={() => setCreateOpen(true)}
        />
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-card shadow-sm overflow-hidden">
          {contacts.map((c, idx) => {
            const org = orgById.get(c.organization_id);
            return (
              <div
                key={c.id}
                className={cn(
                  "flex items-center gap-4 p-4 hover:bg-muted/40 transition-colors",
                  idx > 0 && "border-t border-zinc-200 dark:border-zinc-800"
                )}
              >
                <Avatar className="h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600">
                  <AvatarFallback className="bg-transparent text-white">
                    {getInitials(c.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:items-center">
                  <div className="sm:col-span-3 min-w-0">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {c.name}
                    </p>
                    {c.role && (
                      <p className="text-xs text-muted-foreground truncate">
                        {c.role}
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-3 min-w-0">
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="sm:col-span-2 min-w-0">
                    {c.phone ? (
                      <a
                        href={`tel:${c.phone}`}
                        className="inline-flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{c.phone}</span>
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="sm:col-span-3 min-w-0">
                    {org ? (
                      <span className="inline-flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{org.name}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="sm:col-span-1 flex justify-end">
                    {c.linkedin_url && (
                      <a
                        href={c.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400"
                        title="LinkedIn-profiel"
                      >
                        <Linkedin className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateContactDialog({
  organizations,
  defaultOrganizationId,
  onClose,
}: {
  organizations: Organization[];
  defaultOrganizationId?: string;
  onClose: () => void;
}) {
  const create = useCreateContact();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [organizationId, setOrganizationId] = useState(
    defaultOrganizationId ?? organizations[0]?.id ?? ""
  );
  const [linkedinUrl, setLinkedinUrl] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !organizationId) return;
    await create.mutateAsync({
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      role: role.trim() || null,
      organization_id: organizationId,
      linkedin_url: linkedinUrl.trim() || null,
    });
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Nieuw contact</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ctc-name">Naam *</Label>
          <Input
            id="ctc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ctc-email">E-mail</Label>
            <Input
              id="ctc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctc-phone">Telefoon</Label>
            <Input
              id="ctc-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctc-role">Functie</Label>
          <Input
            id="ctc-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Bijv. Head of Talent Acquisition"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctc-org">Organisatie *</Label>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger id="ctc-org">
              <SelectValue placeholder="Selecteer organisatie" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctc-linkedin">LinkedIn URL</Label>
          <Input
            id="ctc-linkedin"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/..."
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuleren
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !organizationId || create.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {create.isPending ? "Bezig..." : "Aanmaken"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Deals Tab ──────────────────────────────────────────────────────────────

function DealsTab() {
  const { data: pipeline, isLoading } = useDealsPipeline();
  const { data: orgs } = useOrganizations();
  const [createOpen, setCreateOpen] = useState(false);

  const expectedRevenueThisMonth = useMemo(() => {
    if (!pipeline) return 0;
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    return pipeline.gewonnen
      .filter((d) => {
        if (!d.expected_close_date) return false;
        const date = new Date(d.expected_close_date);
        return date.getMonth() === month && date.getFullYear() === year;
      })
      .reduce((sum, d) => sum + d.value_eur, 0);
  }, [pipeline]);

  const totalDeals = useMemo(() => {
    if (!pipeline) return 0;
    return DEAL_STAGES.reduce((sum, s) => sum + pipeline[s].length, 0);
  }, [pipeline]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 px-4 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
            <Euro className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
              Verwachte omzet deze maand
            </p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(expectedRevenueThisMonth)}
            </p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-sm border-0">
              <Plus className="mr-2 h-4 w-4" />
              Nieuwe deal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <CreateDealDialog
              organizations={orgs ?? []}
              onClose={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : totalDeals === 0 ? (
        <EmptyState
          icon={<Target className="h-12 w-12 text-muted-foreground/30" />}
          title="Nog geen deals"
          description="Maak je eerste deal aan om je sales-pipeline op te bouwen."
          ctaLabel="Nieuwe deal"
          onCta={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {DEAL_STAGES.map((stage) => (
            <DealColumn
              key={stage}
              stage={stage}
              deals={pipeline?.[stage] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DealColumn({
  stage,
  deals,
}: {
  stage: DealStage;
  deals: CrmDeal[];
}) {
  const colors = DEAL_STAGE_COLORS[stage];
  const total = deals.reduce((sum, d) => sum + d.value_eur, 0);

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 min-h-[300px]">
      <div
        className={cn(
          "rounded-t-xl border-b px-3 py-2.5 flex items-center justify-between",
          colors.header
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("h-2 w-2 rounded-full", colors.dot)} />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {DEAL_STAGE_LABELS[stage]}
          </h3>
          <span className="text-xs text-muted-foreground shrink-0">
            ({deals.length})
          </span>
        </div>
        {total > 0 && (
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 shrink-0">
            {formatCurrency(total)}
          </span>
        )}
      </div>

      <div className="flex-1 p-2 space-y-2">
        {deals.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Geen deals
          </p>
        ) : (
          deals.map((deal) => <DealCard key={deal.id} deal={deal} />)
        )}
      </div>
    </div>
  );
}

function DealCard({ deal }: { deal: CrmDeal }) {
  const colors = DEAL_STAGE_COLORS[deal.stage];
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-3 shadow-sm hover:shadow-md hover:ring-2 transition-all cursor-pointer",
        colors.ring
      )}
    >
      <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2">
        {deal.title}
      </h4>
      {deal.organization_name && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{deal.organization_name}</span>
        </p>
      )}
      {deal.job_title && (
        <p className="mt-1 text-xs text-indigo-600 dark:text-indigo-400 truncate">
          {deal.job_title}
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <Euro className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {new Intl.NumberFormat("nl-NL").format(deal.value_eur)}
        </span>
        {deal.expected_close_date && (
          <span className="text-xs text-muted-foreground">
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>
      {deal.recruiter_name && (
        <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
          <Avatar className="h-5 w-5 bg-gradient-to-br from-indigo-500 to-purple-600">
            <AvatarFallback className="bg-transparent text-white text-[9px]">
              {getInitials(deal.recruiter_name)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground truncate">
            {deal.recruiter_name}
          </span>
        </div>
      )}
    </div>
  );
}

function CreateDealDialog({
  organizations,
  onClose,
}: {
  organizations: Organization[];
  onClose: () => void;
}) {
  const create = useCreateDeal();
  const [title, setTitle] = useState("");
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? ""
  );
  const [stage, setStage] = useState<DealStage>("prospect");
  const [valueEur, setValueEur] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !organizationId) return;
    await create.mutateAsync({
      title: title.trim(),
      organization_id: organizationId,
      stage,
      value_eur: valueEur ? Number(valueEur) : 0,
      expected_close_date: expectedCloseDate
        ? new Date(expectedCloseDate).toISOString()
        : null,
      notes: notes.trim() || null,
    });
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Nieuwe deal</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="deal-title">Titel *</Label>
          <Input
            id="deal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bijv. Plaatsing Senior Frontend"
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-org">Organisatie *</Label>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger id="deal-org">
              <SelectValue placeholder="Selecteer organisatie" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="deal-stage">Fase</Label>
            <Select
              value={stage}
              onValueChange={(v) => setStage(v as DealStage)}
            >
              <SelectTrigger id="deal-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {DEAL_STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deal-value">Waarde (€)</Label>
            <Input
              id="deal-value"
              type="number"
              min={0}
              step={100}
              value={valueEur}
              onChange={(e) => setValueEur(e.target.value)}
              placeholder="25000"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-close">Verwachte sluitdatum</Label>
          <Input
            id="deal-close"
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-notes">Notities</Label>
          <textarea
            id="deal-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Optionele notities..."
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Annuleren
        </Button>
        <Button
          type="submit"
          disabled={!title.trim() || !organizationId || create.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {create.isPending ? "Bezig..." : "Aanmaken"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
      <div className="mb-4">{icon}</div>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        {description}
      </p>
      <Button
        onClick={onCta}
        className="mt-4 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
      >
        <Plus className="mr-2 h-4 w-4" />
        {ctaLabel}
      </Button>
    </div>
  );
}
