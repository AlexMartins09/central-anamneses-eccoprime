import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Brand } from "@/components/brand";
import { PanelNav, type NavItem } from "@/components/panel-nav";
import { logoutAction } from "@/server/auth-actions";

const ROLE_LABEL = { ADMIN: "Administração", PSYCHOLOGIST: "Psicóloga", COORDINATION: "Atendimento / Coordenação" } as const;

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const s = await getSettings();
  const admin = user.role === "ADMIN";
  const coord = user.role === "COORDINATION";
  const psy = user.role === "PSYCHOLOGIST";

  const items: NavItem[] = [
    { href: "/painel", label: "Início", icon: "home" },
    { href: "/painel/agenda", label: "Agenda", icon: "agenda" },
    { href: "/painel/agendamentos", label: "Agendamentos", icon: "list" },
    ...(admin || psy ? [{ href: "/painel/disponibilidade", label: "Disponibilidade", icon: "avail" } as NavItem] : []),
    ...(admin || coord ? [{ href: "/painel/relatorios", label: "Relatórios", icon: "report" } as NavItem] : []),
    ...(admin
      ? ([
          { href: "/painel/psicologas", label: "Psicólogas", icon: "psy" },
          { href: "/painel/segmentos", label: "Segmentos", icon: "seg" },
          { href: "/painel/usuarios", label: "Usuários", icon: "users" },
        ] as NavItem[])
      : []),
    ...(admin || psy ? [{ href: "/painel/google", label: "Google Agenda", icon: "google" } as NavItem] : []),
    ...(admin
      ? ([
          { href: "/painel/configuracoes", label: "Configurações", icon: "cfg" },
          { href: "/painel/auditoria", label: "Auditoria", icon: "audit" },
        ] as NavItem[])
      : []),
    { href: "/painel/conta", label: "Minha conta", icon: "account" },
  ];

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <PanelNav
        items={items}
        header={<Brand s={s} light />}
        footer={
          <div className="space-y-3 text-white">
            <div className="px-1 text-sm">
              <p className="truncate font-semibold">{user.name}</p>
              <p className="text-xs text-white/70">{ROLE_LABEL[user.role]}</p>
            </div>
            <form action={logoutAction}>
              <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
                <LogOut className="size-4" /> Sair
              </button>
            </form>
          </div>
        }
      />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl space-y-6">{children}</div>
      </main>
    </div>
  );
}
