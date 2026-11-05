"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Baby, BookOpen, CalendarCheck, CheckCircle2, GraduationCap, Loader2, Printer, School, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { Alert } from "@/components/ui/card";
import { MonthCalendar } from "./month-calendar";
import { createBookingAction } from "@/server/booking-actions";
import { cn } from "@/lib/utils";
import { classSuggestions } from "@/lib/classes";

type Segment = { id: string; slug: string; name: string; description: string | null };
type Slot = { id: string; start: string; end: string; psychologist: string };
type Result = {
  code: string; guardianName: string; studentName: string; studentClass: string; phone: string; email: string;
  segment: string; psychologist: string; date: string; longDate: string; time: string; emailEnabled: boolean;
};

const ICONS = [Baby, BookOpen, School, GraduationCap];
const STEPS = ["Segmento", "Data", "Horário", "Seus dados", "Confirmação"];

const longDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function BookingWizard({
  segments, minMonth, maxMonth, contactPhone, attendanceInstructions,
}: {
  segments: Segment[]; minMonth: string; maxMonth: string; contactPhone: string; attendanceInstructions: string;
}) {
  const [step, setStep] = useState(1);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [month, setMonth] = useState(minMonth);
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [loadingDates, setLoadingDates] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ guardianName: "", studentName: "", studentClass: "", phone: "", email: "", consent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createBookingAction, {});

  const loadDates = useCallback(async (seg: string, m: string) => {
    setLoadingDates(true);
    try {
      const r = await fetch(`/api/public/dates?segmentId=${seg}&month=${m}`, { cache: "no-store" });
      const j = await r.json();
      setDates(new Set<string>(j.dates ?? []));
      return (j.dates ?? []) as string[];
    } catch {
      setNotice("Não foi possível carregar as datas. Verifique sua conexão e tente novamente.");
      return [];
    } finally {
      setLoadingDates(false);
    }
  }, []);

  const loadSlots = useCallback(async (seg: string, d: string) => {
    setLoadingSlots(true);
    try {
      const r = await fetch(`/api/public/slots?segmentId=${seg}&date=${d}`, { cache: "no-store" });
      const j = await r.json();
      setSlots(j.slots ?? []);
      return (j.slots ?? []) as Slot[];
    } catch {
      setNotice("Não foi possível carregar os horários. Tente novamente.");
      return [];
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  async function chooseSegment(s: Segment) {
    setSegment(s);
    setDate(null);
    setSlot(null);
    setNotice(null);
    setStep(2);
    // avança automaticamente para o primeiro mês que tenha datas
    let m = minMonth;
    for (let i = 0; i < 6 && m <= maxMonth; i++) {
      const found = await loadDates(s.id, m);
      if (found.length) break;
      const d = new Date(`${m}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      m = d.toISOString().slice(0, 7);
      if (m > maxMonth) {
        setMonth(minMonth);
        await loadDates(s.id, minMonth);
        break;
      }
    }
    setMonth(m <= maxMonth ? m : minMonth);
  }

  async function changeMonth(m: string) {
    setMonth(m);
    if (segment) await loadDates(segment.id, m);
  }

  async function chooseDate(d: string) {
    setDate(d);
    setSlot(null);
    setNotice(null);
    setStep(3);
    if (segment) await loadSlots(segment.id, d);
  }

  function validate() {
    const e: Record<string, string> = {};
    const words = (v: string) => v.trim().split(/\s+/).filter(Boolean).length;
    if (words(form.guardianName) < 2) e.guardianName = "Informe nome e sobrenome do responsável.";
    if (words(form.studentName) < 2) e.studentName = "Informe nome e sobrenome do aluno.";
    if (form.studentClass.trim().length < 2) e.studentClass = "Informe a turma ou série do aluno (ex.: 7º ano B).";
    const digits = form.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (!/^[1-9]{2}9?\d{8}$/.test(digits)) e.phone = "Informe o DDD e o número (ex.: 81 99999-0000).";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) e.email = "Informe um e-mail válido.";
    if (!form.consent) e.consent = "É necessário aceitar a Política de Privacidade.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Resposta do servidor
  useEffect(() => {
    if (state.ok || !state.error) return;
    const code = (state.data as { code?: string } | undefined)?.code;
    if (state.fieldErrors) {
      setErrors(state.fieldErrors);
      setStep(4);
    } else if (code === "SLOT_UNAVAILABLE" || code === "TOO_SOON" || code === "SLOT_IN_PAST") {
      setNotice(state.error);
      setSlot(null);
      setStep(3);
      if (segment && date) loadSlots(segment.id, date);
    }
  }, [state, segment, date, loadSlots]);

  const result = state.ok ? (state.data as unknown as Result) : null;
  const available = useMemo(() => dates, [dates]);

  if (result) return <Success r={result} contactPhone={contactPhone} instructions={attendanceInstructions} />;

  const back = () => {
    setNotice(null);
    setStep((s) => Math.max(1, s - 1));
  };

  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Etapas do agendamento">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          return (
            <li key={label} className="flex min-w-fit flex-1 items-center gap-2" aria-current={n === step ? "step" : undefined}>
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                done ? "bg-success text-success-foreground" : n === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {done ? "✓" : n}
              </span>
              <span className={cn("hidden text-xs font-semibold sm:block", n === step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              {n < STEPS.length && <span className="h-px flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-semibold text-muted-foreground sm:hidden">Etapa {step} de 5 — {STEPS[step - 1]}</p>

      {notice && <Alert variant="warning">{notice}</Alert>}
      {state.error && !state.fieldErrors && step === 5 && <Alert variant="error">{state.error}</Alert>}

      {step > 1 && step < 5 && (
        <Button type="button" variant="ghost" size="sm" onClick={back}><ArrowLeft /> Voltar</Button>
      )}

      {step === 1 && (
        <section aria-labelledby="s1">
          <h2 id="s1" className="mb-4 text-xl font-bold">Qual é o segmento escolar do seu filho(a)?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {segments.map((s, i) => {
              const Icon = ICONS[i % ICONS.length];
              return (
                <button key={s.id} type="button" onClick={() => chooseSegment(s)}
                  className="group flex items-center gap-4 rounded-xl border-2 bg-card p-5 text-left shadow-sm transition hover:border-primary hover:shadow-md">
                  <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="size-7" />
                  </span>
                  <span>
                    <span className="block text-lg font-bold">{s.name}</span>
                    {s.description && <span className="block text-sm text-muted-foreground">{s.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {step === 2 && segment && (
        <section aria-labelledby="s2" className="space-y-4">
          <h2 id="s2" className="text-xl font-bold">Escolha a data — {segment.name}</h2>
          <MonthCalendar month={month} onMonthChange={changeMonth} available={available} selected={date}
            onSelect={chooseDate} minMonth={minMonth} maxMonth={maxMonth} loading={loadingDates} />
          {!loadingDates && dates.size === 0 && (
            <Alert variant="info">
              Não há datas disponíveis neste mês. Use as setas para ver outros meses
              {contactPhone ? <> ou fale com a escola: <strong>{contactPhone}</strong></> : null}.
            </Alert>
          )}
          <p className="text-xs text-muted-foreground">Datas riscadas não possuem horários disponíveis.</p>
        </section>
      )}

      {step === 3 && segment && date && (
        <section aria-labelledby="s3" className="space-y-4">
          <h2 id="s3" className="text-xl font-bold first-letter:uppercase">{longDate(date)}</h2>
          <p className="text-sm text-muted-foreground">Escolha o horário da anamnese:</p>
          {loadingSlots ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando horários…</div>
          ) : slots.length === 0 ? (
            <Alert variant="info">Todos os horários desta data foram preenchidos. Volte e escolha outra data.</Alert>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {slots.map((s) => (
                <button key={s.id} type="button" onClick={() => { setSlot(s); setNotice(null); setStep(4); }}
                  className="rounded-xl border-2 bg-card px-3 py-4 text-center transition hover:border-primary hover:bg-primary/5">
                  <span className="block text-xl font-bold tabular-nums">{s.start}</span>
                  <span className="block text-xs text-muted-foreground">até {s.end}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section aria-labelledby="s4" className="space-y-5">
          <h2 id="s4" className="text-xl font-bold">Identificação da família</h2>
          <form noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (validate()) setStep(5); }}>
            <Fld id="guardianName" label="Nome completo do responsável" error={errors.guardianName}>
              <Input id="guardianName" autoComplete="name" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className="h-12 text-base" />
            </Fld>
            <Fld id="studentName" label="Nome completo do aluno" error={errors.studentName}>
              <Input id="studentName" value={form.studentName} onChange={(e) => setForm({ ...form, studentName: e.target.value })} className="h-12 text-base" />
            </Fld>
            <Fld id="studentClass" label="Turma / série do aluno" error={errors.studentClass}>
              <Input id="studentClass" list="student-class-options" maxLength={40} placeholder={segment?.slug === "fundamental-2" ? "Ex.: 7º ano B ou 2ª série do Médio" : "Ex.: 3º ano B"}
                value={form.studentClass} onChange={(e) => setForm({ ...form, studentClass: e.target.value })} className="h-12 text-base" />
              <datalist id="student-class-options">
                {classSuggestions(segment?.slug ?? "").map((c) => <option key={c} value={c} />)}
              </datalist>
            </Fld>
            <Fld id="phone" label="Telefone / WhatsApp" error={errors.phone}>
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(81) 99999-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-12 text-base" />
            </Fld>
            <Fld id="email" label="E-mail" error={errors.email}>
              <Input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-12 text-base" />
            </Fld>
            <div className="rounded-lg border bg-secondary/50 p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-primary" /> Seus dados e a LGPD</p>
              <p className="mt-1 text-muted-foreground">
                Usamos estas informações apenas para organizar o atendimento e confirmar o agendamento.
                Não pedimos nem registramos informações clínicas neste formulário.
              </p>
              <label className="mt-3 flex items-start gap-3">
                <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  className="mt-0.5 size-5 shrink-0 accent-[hsl(var(--primary))]" />
                <span>
                  Sou o responsável legal pelo aluno e li e concordo com a{" "}
                  <a href="/privacidade" target="_blank" rel="noopener" className="font-semibold text-primary underline">Política de Privacidade</a>.
                </span>
              </label>
              {errors.consent && <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.consent}</p>}
            </div>
            <Button type="submit" size="lg" className="w-full">Continuar</Button>
          </form>
        </section>
      )}

      {step === 5 && segment && slot && date && (
        <section aria-labelledby="s5" className="space-y-5">
          <h2 id="s5" className="text-xl font-bold">Confira e confirme</h2>
          <dl className="divide-y rounded-xl border bg-card">
            {[
              ["Responsável", form.guardianName],
              ["Aluno(a)", form.studentName],
              ["Turma / série", form.studentClass.trim()],
              ["Segmento", segment.name],
              ["Data", longDate(date)],
              ["Horário", `${slot.start} às ${slot.end}`],
              ["Psicóloga responsável", slot.psychologist],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between">
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="slotId" value={slot.id} />
            <input type="hidden" name="segmentId" value={segment.id} />
            <input type="hidden" name="guardianName" value={form.guardianName} />
            <input type="hidden" name="studentName" value={form.studentName} />
            <input type="hidden" name="studentClass" value={form.studentClass} />
            <input type="hidden" name="phone" value={form.phone} />
            <input type="hidden" name="email" value={form.email} />
            <input type="hidden" name="consent" value={form.consent ? "on" : ""} />
            {/* honeypot */}
            <div aria-hidden className="absolute -left-[9999px]">
              <label>Site<input name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            <Button type="submit" size="lg" variant="accent" className="w-full text-base" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <CalendarCheck />}
              {pending ? "Confirmando…" : "CONFIRMAR AGENDAMENTO"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setStep(4)} disabled={pending}>Corrigir meus dados</Button>
          </form>
        </section>
      )}
    </div>
  );
}

function Fld({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-base">{label}</Label>
      {children}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

function Success({ r, contactPhone, instructions }: { r: Result; contactPhone: string; instructions: string }) {
  return (
    <section className="space-y-5" aria-live="polite">
      <div className="rounded-2xl border-2 border-success/40 bg-success/10 p-6 text-center">
        <CheckCircle2 className="mx-auto size-14 text-success" />
        <h2 className="mt-3 text-2xl font-bold">Agendamento confirmado!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {r.emailEnabled ? (
            <>Enviamos a confirmação para <strong>{r.email}</strong>. Confira também a caixa de spam.</>
          ) : (
            <>Guarde o código abaixo ou use o botão de imprimir. Seu agendamento está registrado.</>
          )}
        </p>
        <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">Código do agendamento</p>
        <p className="text-3xl font-extrabold tracking-wider text-primary">{r.code}</p>
      </div>
      <dl className="divide-y rounded-xl border bg-card">
        {[
          ["Aluno(a)", r.studentName],
          ["Turma / série", r.studentClass],
          ["Responsável", r.guardianName],
          ["Telefone", r.phone],
          ["Segmento", r.segment],
          ["Data", r.longDate],
          ["Horário", r.time],
          ["Psicóloga responsável", r.psychologist],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <Alert variant="info"><strong>Orientações:</strong> {instructions}{contactPhone ? <> Contato da escola: <strong>{contactPhone}</strong>.</> : null}</Alert>
      <Button type="button" variant="outline" className="no-print w-full" onClick={() => window.print()}><Printer /> Imprimir / salvar comprovante</Button>
    </section>
  );
}
