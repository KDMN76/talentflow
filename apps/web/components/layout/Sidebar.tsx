"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Kanban,
  Settings,
  Zap,
  LogOut,
  ChevronRight,
  ChevronDown,
  BarChart3,
  MessageSquare,
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
  Lock,
  KeyRound,
  ShieldCheck,
  History,
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
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { clearToken } from "@/lib/auth";
import { getInitials } from "@/lib/utils";
import { useReactivationStats } from "@/hooks/useReactivation";
import { useInboxThreads } from "@/hooks/useInbox";
import { useCurrentUser } from "@/hooks/useUsers";

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

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    badge: "reactivation",
  },
  {
    label: "Inbox",
    href: "/inbox",
    icon: Inbox,
    badge: "inbox_unread",
  },
  {
    label: "Kandidaten",
    href: "/candidates",
    icon: Users,
  },
  {
    label: "Vacatures",
    href: "/jobs",
    icon: Briefcase,
    children: [
      {
        label: "AI Generator",
        href: "/jobs/new/ai-generator",
        icon: Wand2,
      },
      {
        label: "AI Drafts",
        href: "/jobs/jd-drafts",
        icon: Sparkles,
      },
      {
        label: "Distributie",
        href: "/job-boards",
        icon: Megaphone,
      },
    ],
  },
  {
    label: "Pipeline",
    href: "/pipeline",
    icon: Kanban,
  },
  {
    label: "Bureau",
    href: "/contracts",
    icon: FileSignature,
    children: [
      {
        label: "Contracten",
        href: "/contracts",
        icon: FileSignature,
      },
      {
        label: "Timesheets",
        href: "/timesheets",
        icon: Clock,
      },
      {
        label: "Facturen",
        href: "/invoices",
        icon: Receipt,
      },
      {
        label: "Commissie",
        href: "/commissions",
        icon: Calculator,
      },
    ],
  },
  {
    label: "Interviews",
    href: "/interviews",
    icon: Calendar,
    children: [
      {
        label: "Interview kits",
        href: "/interview-kits",
        icon: ClipboardList,
      },
    ],
  },
  {
    label: "Sourcing Agent",
    href: "/sourcing-agent",
    icon: Bot,
  },
  {
    label: "Outreach",
    href: "/outreach",
    icon: Send,
    children: [
      {
        label: "Inbox",
        href: "/outreach/inbox",
        icon: Inbox,
      },
      {
        label: "Sequences",
        href: "/outreach/sequences",
        icon: Workflow,
      },
    ],
  },
  {
    label: "Reactivatie",
    href: "/matching/reactivation",
    icon: Sparkles,
    badge: "reactivation",
  },
  {
    label: "CRM",
    href: "/crm",
    icon: Building2,
  },
  {
    label: "Berichten",
    href: "/communications",
    icon: MessageSquare,
  },
  {
    label: "Career Pages",
    href: "/career-pages",
    icon: Globe,
  },
  {
    label: "Klantportalen",
    href: "/portal-links",
    icon: Share2,
  },
  {
    label: "Hiring Manager",
    href: "/hm",
    icon: Smartphone,
  },
  {
    label: "Skills",
    href: "/skills",
    icon: Network,
  },
  {
    label: "Analytiek",
    href: "/analytics",
    icon: BarChart3,
    children: [
      {
        label: "Cost-per-hire",
        href: "/analytics/cost-per-hire",
        icon: Coins,
      },
      {
        label: "Bureau-overzicht",
        href: "/analytics/back-office",
        icon: PieChart,
      },
    ],
  },
  {
    label: "Rapporten",
    href: "/reports",
    icon: BarChart3,
  },
  {
    label: "Workflows",
    href: "/workflows",
    icon: GitBranch,
  },
  {
    label: "E-mail templates",
    href: "/email-templates",
    icon: FileText,
  },
  {
    label: "AVG / Compliance",
    href: "/gdpr",
    icon: Shield,
    children: [
      {
        label: "WORM Audit-trail",
        href: "/compliance/audit-events",
        icon: History,
      },
    ],
  },
  {
    label: "API & Integraties",
    href: "/api-keys",
    icon: Key,
    children: [
      {
        label: "API Playground",
        href: "/api-explorer",
        icon: Terminal,
      },
    ],
  },
  {
    label: "Instellingen",
    href: "/settings",
    icon: Settings,
    children: [
      {
        label: "WhatsApp",
        href: "/settings/whatsapp",
        icon: MessageSquare,
      },
      {
        label: "Voice",
        href: "/settings/voice",
        icon: Smartphone,
      },
      {
        label: "Boekhouding",
        href: "/settings/accounting",
        icon: Calculator,
      },
      {
        label: "Security overview",
        href: "/settings/security",
        icon: ShieldCheck,
      },
      {
        label: "SSO / SAML",
        href: "/settings/security/sso",
        icon: KeyRound,
      },
      {
        label: "2FA",
        href: "/settings/security/2fa",
        icon: ShieldCheck,
      },
      {
        label: "Rollen & rechten",
        href: "/settings/roles",
        icon: ShieldCheck,
      },
      {
        label: "IP-allowlist",
        href: "/settings/security/ip-allowlist",
        icon: Network,
      },
      {
        label: "Wachtwoord-beleid",
        href: "/settings/security/password-policy",
        icon: Lock,
      },
    ],
  },
];

// Top-level nav-labels → i18n-sleutels (common:nav.*). Op href gemapt zodat we
// niet elk item hoeven aan te passen. Sub-items volgen in de bulk-migratie
// (vallen tot dan terug op hun NL-label).
const NAV_KEY_BY_HREF: Record<string, string> = {
  "/dashboard": "nav.dashboard",
  "/inbox": "nav.inbox",
  "/candidates": "nav.candidates",
  "/jobs": "nav.jobs",
  "/pipeline": "nav.pipeline",
  "/contracts": "nav.agency",
  "/interviews": "nav.interviews",
  "/sourcing-agent": "nav.sourcingAgent",
  "/outreach": "nav.outreach",
  "/matching/reactivation": "nav.reactivation",
  "/crm": "nav.crm",
  "/communications": "nav.messages",
  "/career-pages": "nav.careerPages",
  "/portal-links": "nav.clientPortals",
  "/hm": "nav.hiringManager",
  "/skills": "nav.skills",
  "/analytics": "nav.analytics",
  "/reports": "nav.reports",
  "/workflows": "nav.workflows",
  "/email-templates": "nav.emailTemplates",
  "/gdpr": "nav.compliance",
  "/api-keys": "nav.apiIntegrations",
  "/settings": "nav.settings",
};

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { data: reactivationStats } = useReactivationStats();
  const { data: unreadThreads } = useInboxThreads({ unread: true });
  const { data: currentUser } = useCurrentUser();
  const inboxUnread = (unreadThreads ?? []).length;
  // Auto-expand a section when one of its children is active so the user
  // doesn't lose context on a hard refresh.
  const initiallyExpanded = navItems
    .filter(
      (item) =>
        item.children &&
        item.children.some((c) => pathname.startsWith(c.href))
    )
    .map((item) => item.label);
  const [expanded, setExpanded] = useState<string[]>(initiallyExpanded);

  const toggleExpand = (label: string) => {
    setExpanded((cur) =>
      cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
    );
  };

  const handleLogout = () => {
    clearToken();
    router.push("/login");
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
    return pathname.startsWith(href);
  };

  const reactivationBadge =
    reactivationStats && reactivationStats.unacknowledged > 0
      ? reactivationStats.unacknowledged
      : null;
  const inboxBadge = inboxUnread > 0 ? inboxUnread : null;

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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="mb-3 px-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Menu
          </p>
        </div>
        {navItems.map((item) => {
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
            item.badge === "inbox_unread"
              ? "bg-indigo-600"
              : "bg-purple-500";

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
                  <span className="flex-1">
                    {NAV_KEY_BY_HREF[item.href]
                      ? t(NAV_KEY_BY_HREF[item.href])
                      : item.label}
                  </span>
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
                      isExpanded
                        ? `${item.label} inklappen`
                        : `${item.label} uitklappen`
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
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-border p-3 space-y-2">
        <LanguageSwitcher className="w-full justify-start" />
        <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors group">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
              {getInitials(currentUser?.name ?? "")}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {currentUser?.name ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {currentUser?.role ?? ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-destructive hover:bg-destructive/10 transition-all"
            onClick={handleLogout}
            title={t("actions.logout")}
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
