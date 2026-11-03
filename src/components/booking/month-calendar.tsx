"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DOW = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Calendário mensal acessível. Datas sem disponibilidade ficam desabilitadas. `month` = "yyyy-MM". */
export function MonthCalendar({
  month, onMonthChange, available, selected, onSelect, minMonth, maxMonth, loading,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  available: Set<string>;
  selected?: string | null;
  onSelect: (date: string) => void;
  minMonth: string;
  maxMonth: string;
  loading?: boolean;
}) {
  const [y, m] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(d.toISOString().slice(0, 7));
  };
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];

  return (
    <div className="w-full max-w-md" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={month <= minMonth} aria-label="Mês anterior"
          className="grid size-11 place-items-center rounded-full border bg-card hover:bg-secondary disabled:opacity-30">
          <ChevronLeft className="size-5" />
        </button>
        <p className="text-lg font-bold" aria-live="polite">{MONTHS[m - 1]} de {y}</p>
        <button type="button" onClick={() => shift(1)} disabled={month >= maxMonth} aria-label="Próximo mês"
          className="grid size-11 place-items-center rounded-full border bg-card hover:bg-secondary disabled:opacity-30">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted-foreground">
        {DOW.map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className={cn("mt-1 grid grid-cols-7 gap-1", loading && "opacity-60")}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const key = `${month}-${String(day).padStart(2, "0")}`;
          const ok = available.has(key);
          const sel = selected === key;
          return (
            <button
              key={i}
              type="button"
              disabled={!ok}
              onClick={() => onSelect(key)}
              aria-pressed={sel}
              aria-label={`${day} de ${MONTHS[m - 1]}${ok ? ", com horários disponíveis" : ", indisponível"}`}
              className={cn(
                "aspect-square rounded-lg text-sm font-semibold transition-colors",
                ok ? "bg-accent/10 text-accent hover:bg-accent hover:text-accent-foreground" : "cursor-not-allowed text-muted-foreground/40 line-through decoration-1",
                sel && "!bg-primary !text-primary-foreground ring-2 ring-primary ring-offset-2",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
