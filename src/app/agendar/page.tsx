import Link from "next/link";
import { CalendarHeart } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { Brand } from "@/components/brand";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { Alert } from "@/components/ui/card";
import { addDaysKey, todayKey } from "@/lib/time";

export const metadata = { title: "Agendar anamnese" };
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const s = await getSettings();
  const segments = await prisma.schoolSegment.findMany({
    where: { active: true, deletedAt: null, psychologists: { some: { psychologist: { active: true, deletedAt: null } } } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, name: true, description: true },
  });
  const today = todayKey();

  return (
    <div className="min-h-dvh bg-gradient-to-b from-primary/[0.07] to-background">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Brand s={s} light />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16">
        <section className="-mt-px rounded-b-3xl bg-primary px-4 pb-10 pt-6 text-primary-foreground sm:px-8">
          <div className="flex items-start gap-4">
            <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-white/15 sm:grid"><CalendarHeart className="size-7" /></span>
            <div>
              <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">Central de Agendamento de Anamneses</h1>
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/90">{s.welcomeText}</p>
            </div>
          </div>
        </section>

        <div className="-mt-6 rounded-2xl border bg-card p-4 shadow-lg sm:p-8">
          {segments.length === 0 ? (
            <Alert variant="info">
              O agendamento online ainda não está disponível. Por favor, entre em contato com a escola
              {s.schoolContactPhone ? <>: <strong>{s.schoolContactPhone}</strong></> : null}.
            </Alert>
          ) : (
            <BookingWizard
              segments={segments}
              minMonth={today.slice(0, 7)}
              maxMonth={addDaysKey(today, s.maxDaysAhead).slice(0, 7)}
              contactPhone={s.schoolContactPhone}
              attendanceInstructions={s.attendanceInstructions}
            />
          )}
        </div>

        <footer className="mt-8 space-y-1 text-center text-xs text-muted-foreground">
          <p>Não solicitamos informações clínicas, diagnósticos ou histórico psicológico neste formulário.</p>
          <p>
            <Link href="/privacidade" className="font-semibold underline">Política de Privacidade</Link>
            {" · "}
            <Link href="/login" className="underline">Acesso da equipe</Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
