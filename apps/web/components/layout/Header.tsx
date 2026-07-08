"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Menu, Bell, Search, X, Settings, LogOut, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { cn, getInitials } from "@/lib/utils";
import { api } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { useCurrentUser } from "@/hooks/useUsers";
import { useTenantBranding } from "@/hooks/useTenantBranding";

// TODO: vervangen door echte `useNotifications()` hook zodra het backend-
// endpoint er is. Tot dan: lege lijst — een nieuwe tenant heeft 0 meldingen.
interface Notification {
  id: string;
  icon: typeof Bell;
  color: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}
const INITIAL_NOTIFICATIONS: Notification[] = [];

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t } = useTranslation("dashboard");
  const { data: branding } = useTenantBranding();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const unreadCount = notifications.filter((n) => n.unread).length;

  const markAllRead = () => setNotifications((n) => n.map((x) => ({ ...x, unread: false })));

  // White-label: op mobiel (sidebar dicht) tonen we het tenant-logo of de
  // merknaam in de topbar; fallback = TalentFlow.
  const brandName = branding?.brand_name?.trim() || "TalentFlow";
  const logoUrl = branding?.logo_url ?? null;

  return (
    <header className="flex h-16 items-center gap-4 border-b border-border bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm px-4 lg:px-6 sticky top-0 z-30">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
        <Menu className="h-5 w-5" />
      </Button>

      {/* Mobiel: tenant-logo/merknaam (desktop toont de sidebar-branding al) */}
      <div className="flex items-center gap-2 lg:hidden min-w-0">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={brandName}
            className="h-7 w-auto max-w-[8rem] shrink-0 object-contain"
          />
        ) : (
          <span className="truncate text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {brandName}
          </span>
        )}
      </div>

      <div className="relative hidden md:flex flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder={t("header.searchPlaceholder")} className="pl-9 h-9 bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 focus-visible:ring-1" />
      </div>

      <div className="flex-1" />

      <div className="relative flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          <Bell style={{ width: "18px", height: "18px" }} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-zinc-900" />
          )}
        </Button>

        {open && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

            {/* Panel */}
            <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-border bg-white dark:bg-zinc-900 shadow-xl shadow-black/10 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t("header.notifications.title")}</span>
                  {unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 text-white text-xs font-bold px-1">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline font-medium">
                      {t("header.notifications.markAllRead")}
                    </button>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Notifications */}
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="mx-auto mb-2 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("header.notifications.empty")}</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const Icon = n.icon;
                    return (
                      <div
                        key={n.id}
                        className={cn(
                          "flex gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer",
                          n.unread && "bg-indigo-50/50 dark:bg-indigo-950/20"
                        )}
                        onClick={() => setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, unread: false } : x))}
                      >
                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm", n.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{n.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                          <p className="text-xs text-muted-foreground/60 mt-1">{n.time}</p>
                        </div>
                        {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-4 py-2.5 border-t border-border text-center">
                <button className="text-xs text-indigo-600 hover:underline font-medium">{t("header.notifications.viewAll")}</button>
              </div>
            </div>
          </>
        )}
        <UserMenu />
      </div>
    </header>
  );
}

// ─── Account-menu (rechtsboven): persona + Instellingen + Taal + Uitloggen ────

function UserMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    try {
      // Server-sessie intrekken (refresh-token-rij + httpOnly cookie wissen).
      await api.post("/auth/logout");
    } catch {
      // negeren — client-state wordt hieronder sowieso gewist
    }
    clearToken();
    queryClient.clear();
    router.push("/login");
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label="Account-menu"
      >
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
            {getInitials(currentUser?.name ?? "")}
          </AvatarFallback>
        </Avatar>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-border bg-white dark:bg-zinc-900 shadow-xl shadow-black/10 overflow-hidden">
            {/* Persona */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-semibold">
                  {getInitials(currentUser?.name ?? "")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {currentUser?.name ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {currentUser?.email ?? currentUser?.role ?? ""}
                </p>
              </div>
            </div>

            {/* Acties */}
            <div className="p-1.5">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                Instellingen
              </Link>

              <div className="px-3 py-2">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Taal
                </p>
                <LanguageSwitcher className="w-full justify-start" />
              </div>

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Uitloggen
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
