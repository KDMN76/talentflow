"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Kanban,
  Zap,
  ChevronRight,
  ChevronDown,
  BarChart3,
  GitBranch,
  Building2,
  Globe,
  Megaphone,
  Smartphone,
  Share2,
  FileText,
  Shield,
  Wand2,
  Sparkles,
  Calendar,
  ClipboardList,
  Network,
  Key,
  Terminal,
  History,
  Activity,
  Coins,
  FileSignature,
  Clock,
  Receipt,
  Calculator,
  PieChart,
  Bot,
  Send,
  Inbox,
  Workflow,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { useReactivationStats } from "@/hooks/useReactivation";
import { useInboxThreads } from "@/hooks/useInbox";

interface NavSubItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Optional collapsible sub-items. */
  children?: NavSubItem[];
  /** Optional badge key — wired via custom data sources. */
  badge?: "reactivation" | "inbox_unread";
}

// Recruiter-vriendelijk menu: weinig items bovenaan (dagelijks werk), de rest in
// inklapbare secties die standaard dicht zijn (alleen de actieve sectie open).
// Technische zaken onder "Systeem". Persona/taal/uitloggen staan rechtsboven.
const NAV_PRIMARY: NavItem[] = [
  { label: "Start", href: "/dashboard", icon: LayoutDashboard, badge: "reactivation" },
  { label: "Kandidaten", href: "/candidates", icon: Users },
  {
    label: "Vacatures",
    href: "/jobs",
    icon: Briefcase,
    children: [
      { label: "AI Generator", href: "/jobs/new/ai-generator", icon: Wand2 },
      { label: "AI Drafts", href: "/jobs/jd-drafts", icon: Sparkles },
      { label: "Distributie", href: "/job-boards", icon: Megaphone },
    ],
  },
  { label: "Klanten", href: "/crm", icon: Building2 },
  { label: "Pipeline", href: "/pipeline", icon: Kanban },
  { label: "Berichten", href: "/inbox", icon: Inbox, badge: "inbox_unread" },
];

const NAV_RECRUITMENT: NavItem[] = [
  {
    label: "Interviews",
    href: "/interviews",
    icon: Calendar,
    children: [{ label: "Interview kits", href: "/interview-kits", icon: ClipboardList }],
  },
  { label: "Sourcing", href: "/sourcing-agent", icon: Bot },
  {
    label: "Reactivatie",
    href: "/matching/reactivation",
    icon: Sparkles,
    badge: "reactivation",
  },
  {
    label: "Benaderen",
    href: "/outreach",
    icon: Send,
    children: [
      { label: "Inbox", href: "/outreach/inbox", icon: Inbox },
      { label: "Opvolgreeks", href: "/outreach/sequences", icon: Workflow },
      { label: "E-mailtemplates", href: "/email-templates", icon: FileText },
    ],
  },
  {
    label: "Contracten",
    href: "/contracts",
    icon: FileSignature,
    children: [
      { label: "Overzicht", href: "/contracts", icon: FileSignature },
      { label: "Uren", href: "/timesheets", icon: Clock },
      { label: "Facturen", href: "/invoices", icon: Receipt },
      { label: "Commissie", href: "/commissions", icon: Calculator },
    ],
  },
];

const NAV_CLIENTS: NavItem[] = [
  { label: "Career-pagina's", href: "/career-pages", icon: Globe },
  { label: "Klantportaal", href: "/portal-links", icon: Share2 },
  { label: "Beoordelaars", href: "/hm", icon: Smartphone },
];

const NAV_INSIGHTS: NavItem[] = [
  {
    label: "Rapporten",
    href: "/analytics",
    icon: BarChart3,
    children: [
      { label: "Cost-per-hire", href: "/analytics/cost-per-hire", icon: Coins },
      { label: "Bureau-overzicht", href: "/analytics/back-office", icon: PieChart },
    ],
  },
  { label: "Skills", href: "/skills", icon: Network },
];

const NAV_SYSTEM: NavItem[] = [
  { label: "Activiteit", href: "/compliance/audit-events", icon: Activity },
  { label: "Workflows", href: "/workflows", icon: GitBranch },
  {
    label: "AVG / Privacy",
    href: "/gdpr",
    icon: Shield,
    children: [{ label: "WORM-audit", href: "/compliance/audit-events", icon: History }],
  },
  {
    label: "API & integraties",
    href: "/api-keys",
    icon: Key,
    children: [{ label: "API Playground", href: "/api-explorer", icon: Terminal }],
  },
];

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  { title: "Recruitment", items: NAV_RECRUITMENT },
  { title: "Klant & extern", items: NAV_CLIENTS },
  { title: "Analyse", items: NAV_INSIGHTS },
  { title: "Systeem", items: NAV_SYSTEM },
];

// Platte lijst voor logica die alle items nodig heeft (auto-expand e.d.).
const allNavItems: NavItem[] = [
  ...NAV_PRIMARY,
  ...NAV_SECTIONS.flatMap((s) => s.items),
];

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: reactivationStats } = useReactivationStats();
  const { data: unreadThreads } = useInboxThreads({ unread: true });
  const inboxUnread = (unreadThreads ?? []).length;

  // Welke item-children staan open (auto-open als een child actief is).
  const initiallyExpanded = allNavItems
    .filter(
      (item) =>
        item.children && item.children.some((c) => pathname.startsWith(c.href))
    )
    .map((item) => item.label);
  const [expanded, setExpanded] = useState<string[]>(initiallyExpanded);

  const toggleExpand = (label: string) => {
    setExpanded((cur) =>
      cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
    );
  };

  // Welke secties staan open. Standaard dicht — behalve de sectie die de huidige
  // pagina bevat (zodat je context niet kwijtraakt bij een refresh).
  const sectionMatchesPath = (section: NavSection) =>
    section.items.some(
      (item) =>
        pathname.startsWith(item.href) ||
        item.children?.some((c) => pathname.startsWith(c.href))
    );
  const [openSections, setOpenSections] = useState<string[]>(
    NAV_SECTIONS.filter(sectionMatchesPath).map((s) => s.title)
  );
  const toggleSection = (title: string) => {
    setOpenSections((cur) =>
      cur.includes(title) ? cur.filter((s) => s !== title) : [...cur, title]
    );
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/pipeline") return pathname === "/pipeline";
    if (href === "/matching/reactivation")
      return pathname.startsWith("/matching/reactivation");
    if (href === "/interviews")
      return (
        pathname.startsWith("/interviews") &&
        !pathname.startsWith("/interview-kits")
      );
    if (href === "/outreach")
      return (
        pathname === "/outreach" ||
        (pathname.startsWith("/outreach") &&
          !pathname.startsWith("/outreach/sequences") &&
          !pathname.startsWith("/outreach/inbox"))
      );
    if (href === "/jobs")
      return (
        pathname.startsWith("/jobs") &&
        !pathname.includes("/pipeline") &&
        !pathname.startsWith("/jobs/new/ai-generator") &&
        !pathname.startsWith("/jobs/jd-drafts")
      );
    if (href === "/contracts") return pathname === "/contracts";
    return pathname.startsWith(href);
  };

  const reactivationBadge =
    reactivationStats && reactivationStats.unacknowledged > 0
      ? reactivationStats.unacknowledged
      : null;
  const inboxBadge = inboxUnread > 0 ? inboxUnread : null;

  const renderItem = (item: NavItem) => {
    const active = isActive(item.href);
    const Icon = item.icon;
    const hasChildren = !!item.children && item.children.length > 0;
    const isExpanded = expanded.includes(item.label);
    const badgeCount =
      item.badge === "reactivation"
        ? reactivationBadge
        : item.badge === "inbox_unread"
        ? inboxBadge
        : null;
    const showBadge = badgeCount !== null;
    const badgeColor =
      item.badge === "inbox_unread" ? "bg-indigo-600" : "bg-purple-500";

    return (
      <div key={item.label}>
        <div className="flex items-center">
          <Link
            href={item.href}
            onClick={onClose}
            className={cn(
              "group flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
              active
                ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400"
                : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            )}
          >
            <Icon
              className={cn(
                "h-4.5 w-4.5 shrink-0 transition-colors",
                active
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
              )}
              style={{ width: "18px", height: "18px" }}
            />
            <span className="flex-1">{item.label}</span>
            {showBadge && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white shadow-sm",
                  badgeColor
                )}
                title={
                  item.badge === "inbox_unread"
                    ? `${badgeCount} ongelezen berichten`
                    : `${badgeCount} nieuwe reactivatie-alerts`
                }
              >
                {badgeCount! > 9 ? "9+" : badgeCount}
              </span>
            )}
            {!showBadge && active && !hasChildren && (
              <ChevronRight className="h-3.5 w-3.5 text-indigo-400" />
            )}
          </Link>
          {hasChildren && (
            <button
              type="button"
              onClick={() => toggleExpand(item.label)}
              className="ml-1 rounded-md p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label={
                isExpanded ? `${item.label} inklappen` : `${item.label} uitklappen`
              }
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div className="ml-7 mt-0.5 space-y-0.5 border-l border-border pl-2">
            {item.children!.map((child) => {
              const ChildIcon = child.icon;
              const childActive = pathname.startsWith(child.href);
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
                    childActive
                      ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                      : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  )}
                >
                  <ChildIcon
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ width: "14px", height: "14px" }}
                  />
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="flex h-full w-64 flex-col bg-white dark:bg-zinc-900 border-r border-border">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm shadow-indigo-200">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          TalentFlow
        </span>
      </div>

      {/* Navigatie */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* Dagelijks — altijd zichtbaar */}
        <div className="mb-4 space-y-1">{NAV_PRIMARY.map(renderItem)}</div>

        {/* Inklapbare secties (standaard dicht, behalve de actieve) */}
        {NAV_SECTIONS.map((section) => {
          const open = openSections.includes(section.title);
          return (
            <div key={section.title} className="mb-1.5">
              <button
                type="button"
                onClick={() => toggleSection(section.title)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                {section.title}
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              {open && (
                <div className="mt-0.5 space-y-1">
                  {section.items.map(renderItem)}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
