import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input } from "@/components/ui/form";
import { changePasswordAction } from "@/server/auth-actions";

export const metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Minha conta" description={`${user.name} · ${user.email}`} />
      <Card className="max-w-lg">
        <CardHeader><CardTitle>Alterar senha</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-4">
            <Field label="Senha atual"><Input name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label="Nova senha" hint="Mín. 10 caracteres, com maiúscula, minúscula e número.">
              <Input name="next" type="password" autoComplete="new-password" required />
            </Field>
            <Field label="Confirmar nova senha"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
            <SubmitButton>Alterar senha</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
