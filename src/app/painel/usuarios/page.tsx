import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui/card";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input, Select } from "@/components/ui/form";
import { createStaffUserAction, resetUserPasswordAction, setUserActiveAction } from "@/server/admin-actions";

export const metadata = { title: "Usuários" };
const ROLE = { ADMIN: "Administrador", PSYCHOLOGIST: "Psicóloga", COORDINATION: "Atendimento / Coordenação" } as const;

export default async function UsersPage() {
  const me = await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({ where: { deletedAt: null }, orderBy: [{ role: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="Usuários" description="Administração e atendimento. Psicólogas são gerenciadas na página própria." />
      <Card>
        <CardHeader><CardTitle>Novo usuário</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={createStaffUserAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Nome completo"><Input name="name" required /></Field>
            <Field label="E-mail"><Input name="email" type="email" required /></Field>
            <Field label="Perfil">
              <Select name="role" defaultValue="COORDINATION">
                <option value="COORDINATION">Atendimento / Coordenação</option>
                <option value="ADMIN">Administrador</option>
              </Select>
            </Field>
            <Field label="Senha inicial"><Input name="password" type="password" autoComplete="new-password" required /></Field>
            <SubmitButton className="sm:w-fit">Criar usuário</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <Table>
          <thead>
            <tr><Th>Nome</Th><Th>E-mail</Th><Th>Perfil</Th><Th>Último acesso</Th><Th>Situação</Th><Th>Ações</Th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{ROLE[u.role]}</Td>
                <Td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—"}</Td>
                <Td><Badge variant={u.active ? "success" : "muted"}>{u.active ? "Ativo" : "Inativo"}</Badge></Td>
                <Td>
                  {u.role !== "PSYCHOLOGIST" && u.id !== me.id && (
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionForm action={setUserActiveAction}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value={String(!u.active)} />
                        <SubmitButton size="sm" variant="outline">{u.active ? "Desativar" : "Reativar"}</SubmitButton>
                      </ActionForm>
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-primary">Nova senha</summary>
                        <ActionForm action={resetUserPasswordAction} className="mt-2 flex gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <Input name="password" type="password" autoComplete="new-password" className="h-8 w-40" required />
                          <SubmitButton size="sm">OK</SubmitButton>
                        </ActionForm>
                      </details>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
