import { ZodError } from "zod";
import { ActionError } from "./errors";
import { BookingError } from "./booking";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: Record<string, unknown>;
};

/** Converte exceções conhecidas em mensagens amigáveis; o restante vira erro genérico (sem vazar detalhes). */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) fieldErrors[String(issue.path[0] ?? "_")] ??= issue.message;
      return { ok: false, error: "Confira os campos destacados.", fieldErrors };
    }
    if (e instanceof BookingError) return { ok: false, error: e.message, data: { code: e.code } };
    if (e instanceof ActionError) return { ok: false, error: e.message };
    console.error("[action]", e);
    return { ok: false, error: "Não foi possível concluir a operação. Tente novamente." };
  }
}

function isNextControlFlow(e: unknown) {
  const d = (e as { digest?: string })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}

export const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
export const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";
