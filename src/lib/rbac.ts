import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import { ActionError } from "./errors";
import type { AppSettings } from "./settings";

/** Filtro Prisma de visibilidade: administração e atendimento veem tudo; psicóloga vê só a própria agenda (salvo autorização). */
export function visibleToUser(user: SessionUser): { psychologistId?: string } {
  if (user.role === "PSYCHOLOGIST" && !user.canViewOthers) {
    return { psychologistId: user.psychologistId ?? "__none__" };
  }
  return {};
}

/** Psicólogas só gerenciam a própria disponibilidade; administradores gerenciam qualquer uma. */
export function assertCanManageAvailability(user: SessionUser, psychologistId: string) {
  if (user.role === "ADMIN") return;
  if (user.role === "PSYCHOLOGIST" && user.psychologistId === psychologistId) return;
  throw new ActionError("Você não tem permissão para gerenciar esta agenda.");
}

/** Cancelar/remarcar/editar um agendamento. */
export function canManageAppointment(
  user: SessionUser,
  appt: { psychologistId: string },
  settings: Pick<AppSettings, "coordinationCanCancel">,
): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "COORDINATION") return settings.coordinationCanCancel;
  return user.role === "PSYCHOLOGIST" && user.psychologistId === appt.psychologistId;
}

export function assertCanManageAppointment(
  user: SessionUser,
  appt: { psychologistId: string },
  settings: Pick<AppSettings, "coordinationCanCancel">,
) {
  if (!canManageAppointment(user, appt, settings)) throw new ActionError("Você não tem permissão para alterar este agendamento.");
}

export type AppointmentWhere = Prisma.AppointmentWhereInput;
