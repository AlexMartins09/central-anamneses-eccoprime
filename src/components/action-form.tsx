"use client";

import { useActionState, useEffect, useRef } from "react";
import { Alert } from "@/components/ui/card";
import type { ActionState } from "@/lib/action";

/**
 * Formulário genérico para Server Actions: mostra erro/sucesso, expõe erros por campo via `data-error-for`
 * e limpa o formulário quando `resetOnSuccess`.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode | ((state: ActionState) => React.ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
  }, [state, resetOnSuccess, onSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {state.error && <Alert variant="error" className="mb-4">{state.error}</Alert>}
      {state.ok && state.message && <Alert variant="success" className="mb-4">{state.message}</Alert>}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}
