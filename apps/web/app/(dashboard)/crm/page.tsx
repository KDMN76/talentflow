"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  useUpdateDealStage,
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

// Maps an organization type to its translation key suffix under `orgType.*`.
// The label itself is resolved with `t` inside the consuming component.
const ORG_TYPE_LABEL_KEYS: Record<Organization["type"], string> = {
  client: "client",
  prospect: "prospect",
  partner: "partner",
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
  const { t } = useTranslation("crmPage");
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
      />

      <Tabs defaultValue="organizations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organizations">
            <Building2 className="h-4 w-4 mr-2" />
            {t("tabs.organizations")}
          </TabsTrigger>
          <TabsTrigger value="contacts">
            <Users className="h-4 w-4 mr-2" />
            {t("tabs.contacts")}
          </TabsTrigger>
          <TabsTrigger value="deals">
            <Target className="h-4 w-4 mr-2" />
            {t("tabs.deals")}
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
  const { t } = useTranslation("crmPage");
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
            placeholder={t("organizations.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-sm border-0">
              <Plus className="mr-2 h-4 w-4" />
              {t("organizations.newButton")}
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
            search
              ? t("organizations.emptySearchTitle")
              : t("organizations.emptyTitle")
          }
          description={
            search
              ? t("organizations.emptySearchDescription")
              : t("organizations.emptyDescription")
          }
          ctaLabel={t("organizations.newButton")}
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
  const { t } = useTranslation("crmPage");
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
          {t(`orgType.${ORG_TYPE_LABEL_KEYS[org.type]}`)}
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
  const { t } = useTranslation("crmPage");
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
        <DialogTitle>{t("organizations.dialog.title")}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="org-name">{t("organizations.dialog.nameLabel")}</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("organizations.dialog.namePlaceholder")}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-industry">
            {t("organizations.dialog.industryLabel")}
          </Label>
          <Input
            id="org-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder={t("organizations.dialog.industryPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-website">
            {t("organizations.dialog.websiteLabel")}
          </Label>
          <Input
            id="org-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-type">{t("organizations.dialog.typeLabel")}</Label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as Organization["type"])}
          >
            <SelectTrigger id="org-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prospect">{t("orgType.prospect")}</SelectItem>
              <SelectItem value="client">{t("orgType.client")}</SelectItem>
              <SelectItem value="partner">{t("orgType.partner")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-notes">
            {t("organizations.dialog.notesLabel")}
          </Label>
          <textarea
            id="org-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t("organizations.dialog.notesPlaceholder")}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {create.isPending ? t("actions.saving") : t("actions.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Contacts Tab ───────────────────────────────────────────────────────────

function ContactsTab() {
  const { t } = useTranslation("crmPage");
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
              <SelectValue placeholder={t("contacts.filterPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("contacts.allOrganizations")}</SelectItem>
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
              {t("contacts.newButton")}
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
          title={t("contacts.emptyTitle")}
          description={t("contacts.emptyDescription")}
          ctaLabel={t("contacts.newButton")}
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
                        title={t("contacts.linkedinTitle")}
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
  const { t } = useTranslation("crmPage");
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
        <DialogTitle>{t("contacts.dialog.title")}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ctc-name">{t("contacts.dialog.nameLabel")}</Label>
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
            <Label htmlFor="ctc-email">{t("contacts.dialog.emailLabel")}</Label>
            <Input
              id="ctc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ctc-phone">{t("contacts.dialog.phoneLabel")}</Label>
            <Input
              id="ctc-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctc-role">{t("contacts.dialog.roleLabel")}</Label>
          <Input
            id="ctc-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t("contacts.dialog.rolePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctc-org">
            {t("contacts.dialog.organizationLabel")}
          </Label>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger id="ctc-org">
              <SelectValue
                placeholder={t("contacts.dialog.organizationPlaceholder")}
              />
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
          <Label htmlFor="ctc-linkedin">
            {t("contacts.dialog.linkedinLabel")}
          </Label>
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
          {t("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !organizationId || create.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {create.isPending ? t("actions.saving") : t("actions.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Deals Tab ──────────────────────────────────────────────────────────────

function DealsTab() {
  const { t } = useTranslation("crmPage");
  const { data: pipeline, isLoading } = useDealsPipeline();
  const { data: orgs } = useOrganizations();
  const moveStage = useUpdateDealStage();
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
              {t("deals.expectedRevenue")}
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
              {t("deals.newButton")}
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
          title={t("deals.emptyTitle")}
          description={t("deals.emptyDescription")}
          ctaLabel={t("deals.newButton")}
          onCta={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {DEAL_STAGES.map((stage) => (
            <DealColumn
              key={stage}
              stage={stage}
              deals={pipeline?.[stage] ?? []}
              onMoveDeal={(dealId) => moveStage.mutate({ id: dealId, stage })}
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
  onMoveDeal,
}: {
  stage: DealStage;
  deals: CrmDeal[];
  onMoveDeal: (dealId: string) => void;
}) {
  const { t } = useTranslation("crmPage");
  const colors = DEAL_STAGE_COLORS[stage];
  const total = deals.reduce((sum, d) => sum + d.value_eur, 0);
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const dealId = e.dataTransfer.getData("text/plain");
        if (dealId) onMoveDeal(dealId);
      }}
      className={cn(
        "flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 min-h-[300px] transition-shadow",
        isOver && "ring-2 ring-indigo-400 ring-inset"
      )}
    >
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
            {t("deals.noDeals")}
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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-3 shadow-sm hover:shadow-md hover:ring-2 transition-all cursor-grab active:cursor-grabbing",
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
  const { t } = useTranslation("crmPage");
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
        <DialogTitle>{t("deals.dialog.title")}</DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="deal-title">{t("deals.dialog.titleLabel")}</Label>
          <Input
            id="deal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("deals.dialog.titlePlaceholder")}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-org">
            {t("deals.dialog.organizationLabel")}
          </Label>
          <Select value={organizationId} onValueChange={setOrganizationId}>
            <SelectTrigger id="deal-org">
              <SelectValue
                placeholder={t("deals.dialog.organizationPlaceholder")}
              />
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
            <Label htmlFor="deal-stage">{t("deals.dialog.stageLabel")}</Label>
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
            <Label htmlFor="deal-value">{t("deals.dialog.valueLabel")}</Label>
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
          <Label htmlFor="deal-close">{t("deals.dialog.closeDateLabel")}</Label>
          <Input
            id="deal-close"
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-notes">{t("deals.dialog.notesLabel")}</Label>
          <textarea
            id="deal-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t("deals.dialog.notesPlaceholder")}
            className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!title.trim() || !organizationId || create.isPending}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          {create.isPending ? t("actions.saving") : t("actions.create")}
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
