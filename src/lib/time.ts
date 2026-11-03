import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

/** Fuso de negócio. Todos os instantes ficam em UTC no banco; a exibição e as regras usam este fuso. */
export const TZ = "America/Recife";

/** "2026-03-10" + minuto do dia (ex.: 540 = 09:00) -> instante UTC. */
export function localToUtc(dateKey: string, minuteOfDay: number): Date {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const m = String(minuteOfDay % 60).padStart(2, "0");
  return fromZonedTime(`${dateKey}T${h}:${m}:00`, TZ);
}

export function startOfLocalDay(dateKey: string): Date {
  return localToUtc(dateKey, 0);
}

/** Início do dia seguinte (limite exclusivo). */
export function endOfLocalDay(dateKey: string): Date {
  return startOfLocalDay(addDaysKey(dateKey, 1));
}

/** yyyy-MM-dd no fuso de Recife. */
export function dateKey(d: Date): string {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

export function todayKey(now = new Date()): string {
  return dateKey(now);
}

export function fmtDate(d: Date): string {
  return formatInTimeZone(d, TZ, "dd/MM/yyyy");
}

export function fmtTime(d: Date): string {
  return formatInTimeZone(d, TZ, "HH:mm");
}

export function fmtDateTime(d: Date): string {
  return formatInTimeZone(d, TZ, "dd/MM/yyyy 'às' HH:mm");
}

export function fmtLongDate(d: Date): string {
  return formatInTimeZone(d, TZ, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

export function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo ... 6 = sábado, de uma data yyyy-MM-dd (independente de fuso). */
export function weekdayOf(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

export function* eachDateKey(from: string, to: string): Generator<string> {
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 800) {
    yield cur;
    cur = addDaysKey(cur, 1);
  }
}

export function minutesToHHmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
