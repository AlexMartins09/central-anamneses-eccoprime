import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Brand } from "@/components/brand";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input } from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { loginAction } from "@/server/auth-actions";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/painel");
  const s = await getSettings();
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-br from-primary/10 via-background to-accent/10 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <Brand s={s} className="justify-center" />
        <Card>
          <CardContent className="space-y-5 p-6 pt-6">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-5 text-primary" />
              <h1 className="text-lg font-bold">Acesso da equipe</h1>
            </div>
            <ActionForm action={loginAction} className="space-y-4">
              <Field label="E-mail">
                <Input name="email" type="email" autoComplete="username" required autoFocus />
              </Field>
              <Field label="Senha">
                <Input name="password" type="password" autoComplete="current-password" required />
              </Field>
              <SubmitButton className="w-full" pendingText="Entrando…">
                Entrar
              </SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Área restrita a colaboradores. Famílias devem usar o link de agendamento enviado pela escola.
        </p>
      </div>
    </main>
  );
}
