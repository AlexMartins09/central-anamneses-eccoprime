import type { AppointmentStatus, SyncStatus } from "@prisma/client";
import { Badge } from "@/components/ui/card";

const APPT: Record<AppointmentStatus, [string, "default" | "success" | "danger" | "warning" | "muted"]> = {
  CONFIRMED: ["Confirmado", "default"],
  COMPLETED: ["Realizado", "success"],
  NO_SHOW: ["Não compareceu", "warning"],
  CANCELLED: ["Cancelado", "danger"],
};

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  CONFIRMED: "Confirmado", COMPLETED: "Realizado", NO_SHOW: "Não compareceu", CANCELLED: "Cancelado",
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const [label, variant] = APPT[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const SYNC: Record<SyncStatus, [string, "default" | "success" | "danger" | "warning" | "muted"]> = {
  PENDING: ["Pendente", "warning"],
  SYNCED: ["Sincronizado", "success"],
  FAILED: ["Falhou", "danger"],
  CANCELLED: ["Removido", "muted"],
  SKIPPED: ["Aguardando conexão", "muted"],
};

export function SyncBadge({ status }: { status: SyncStatus }) {
  const [label, variant] = SYNC[status];
  return <Badge variant={variant}>{label}</Badge>;
}
