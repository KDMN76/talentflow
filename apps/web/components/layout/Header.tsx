"use client";

import { useState } from "react";
import { Menu, Bell, Search, Briefcase, Users, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MOCK_NOTIFICATIONS = [
  { id: "1", icon: Users, color: "text-indigo-600 bg-indigo-50", title: "Nieuwe sollicitatie", body: "Maya Okonkwo heeft gesolliciteerd op Senior Frontend Developer", time: "5 min geleden", unread: true },
  { id: "2", icon: ArrowRight, color: "text-purple-600 bg-purple-50", title: "Fase gewijzigd", body: "Sophie van den Berg is doorgestuurd naar Interview", time: "1 uur geleden", unread: true },
  { id: "3", icon: Briefcase, color: "text-emerald-600 bg-emerald-50", title: "Vacature gepubliceerd", body: "Product Manager is nu actief", time: "3 uur geleden", unread: false },
];

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const unreadCount = notifications.filter((n) => n.unread).length;

  const markAllRead = () => setNotifications((n) => n.map((x) => ({ ...x, unread: false })));

  return (
    <header className="flex h-16 items-center gap-4 border-b border-border bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm px-4 lg:px-6 sticky top-0 z-30">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
        <Menu className="h-5 w-5" />
      </Button>

      <div className="relative hidden md:flex flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Zoeken..." className="pl-9 h-9 bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 focus-visible:ring-1" />
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
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Meldingen</span>
                  {unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 text-white text-xs font-bold px-1">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline font-medium">
                      Alles gelezen
                    </button>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Notifications */}
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {notifications.map((n) => {
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
                })}
              </div>

              <div className="px-4 py-2.5 border-t border-border text-center">
                <button className="text-xs text-indigo-600 hover:underline font-medium">Alle meldingen bekijken</button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
