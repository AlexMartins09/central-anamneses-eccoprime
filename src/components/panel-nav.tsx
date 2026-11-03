"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, CalendarCheck, CalendarClock, CalendarDays, Cog, GraduationCap, History, KeyRound,
  LayoutDashboard, Link2, Menu, Users, UserRound, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  home: LayoutDashboard, agenda: CalendarDays, list: CalendarCheck, avail: CalendarClock, report: BarChart3,
  psy: UserRound, seg: GraduationCap, users: Users, google: Link2, cfg: Cog, audit: History, account: KeyRound,
} as const;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

export function PanelNav({ items, header, footer }: { items: NavItem[]; header: React.ReactNode; footer: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const links = (
    <nav aria-label="Menu principal" className="flex flex-col gap-1">
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const active = href === "/painel" ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Barra superior (mobile/tablet) */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-primary px-4 py-3 text-white lg:hidden">
        {header}
        <button
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid size-10 place-items-center rounded-md hover:bg-white/10"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="no-print fixed inset-x-0 top-[68px] bottom-0 z-20 overflow-y-auto bg-primary p-4 lg:hidden">
          {links}
          <div className="mt-6 border-t border-white/15 pt-4">{footer}</div>
        </div>
      )}
      {/* Barra lateral (desktop) */}
      <aside className="no-print hidden w-64 shrink-0 flex-col bg-primary p-4 text-white lg:flex">
        <div className="mb-6 px-1 pt-1">{header}</div>
        <div className="flex-1 overflow-y-auto">{links}</div>
        <div className="mt-4 border-t border-white/15 pt-4">{footer}</div>
      </aside>
    </>
  );
}
