import Link from "next/link";
import type { SchoolSegment, Psychologist } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type { Filters } from "@/lib/queries";

const PERIODS = [
  ["hoje", "Hoje"],
  ["semana", "Esta semana"],
  ["mes", "Este mês"],
  ["personalizado", "Período personalizado"],
  ["todos", "Todo o histórico"],
] as const;

const STATUS = [
  ["", "Todos os status"],
  ["CONFIRMED", "Confirmado"],
  ["COMPLETED", "Realizado"],
  ["NO_SHOW", "Não compareceu"],
  ["CANCELLED", "Cancelado"],
] as const;

/** Filtros por GET (links compartilháveis, sem JavaScript). */
export function FilterBar({
  f, segments, psychologists, showPsychologist = true, showStatus = true, showSearch = true, action,
}: {
  f: Filters;
  segments: Pick<SchoolSegment, "id" | "name">[];
  psychologists: Pick<Psychologist, "id" | "name">[];
  showPsychologist?: boolean;
  showStatus?: boolean;
  showSearch?: boolean;
  action: string;
}) {
  return (
    <form action={action} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1 text-xs font-medium text-muted-foreground">Período
        <Select name="periodo" defaultValue={f.period} className="text-foreground">
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">De (personalizado)
        <Input type="date" name="de" defaultValue={f.period === "personalizado" ? f.from : ""} className="text-foreground" />
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">Até (personalizado)
        <Input type="date" name="ate" defaultValue={f.period === "personalizado" ? f.to : ""} className="text-foreground" />
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">Segmento
        <Select name="segmento" defaultValue={f.segmentId ?? ""} className="text-foreground">
          <option value="">Todos os segmentos</option>
          {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </label>
      {showPsychologist && (
        <label className="space-y-1 text-xs font-medium text-muted-foreground">Psicóloga
          <Select name="psicologa" defaultValue={f.psychologistId ?? ""} className="text-foreground">
            <option value="">Todas as psicólogas</option>
            {psychologists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
      )}
      {showStatus && (
        <label className="space-y-1 text-xs font-medium text-muted-foreground">Status
          <Select name="status" defaultValue={f.status ?? ""} className="text-foreground">
            {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </label>
      )}
      {showSearch && (
        <label className="space-y-1 text-xs font-medium text-muted-foreground">Buscar (aluno, responsável, código)
          <Input name="q" defaultValue={f.q ?? ""} className="text-foreground" maxLength={80} />
        </label>
      )}
      <div className="flex items-end gap-2">
        <Button type="submit">Filtrar</Button>
        <Button asChild variant="ghost"><Link href={action}>Limpar</Link></Button>
      </div>
    </form>
  );
}
