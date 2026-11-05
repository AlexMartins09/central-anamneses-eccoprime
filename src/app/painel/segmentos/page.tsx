import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Field, Input } from "@/components/ui/form";
import { createSegmentAction, setSegmentPsychologistsAction, updateSegmentAction } from "@/server/admin-actions";

export const metadata = { title: "Segmentos" };

const checkbox = "size-4 accent-[hsl(var(--primary))]";

export default async function SegmentsPage() {
  await requireUser(["ADMIN"]);
  const [segments, psychologists, freeSlots] = await Promise.all([
    prisma.schoolSegment.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, include: { psychologists: true } }),
    prisma.psychologist.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" } }),
    prisma.availabilitySlot.groupBy({
      by: ["segmentId"],
      where: { status: "AVAILABLE", startsAt: { gt: new Date() }, psychologist: { active: true, deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  const freeBySegment = new Map(freeSlots.map((f) => [f.segmentId, f._count._all]));

  return (
    <>
      <PageHeader
        title="Segmentos escolares"
        description="Cada segmento tem agenda independente. Associe as psicólogas responsáveis sem alterar código."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {segments.map((seg) => {
          const assigned = new Set(seg.psychologists.map((p) => p.psychologistId));
          return (
            <Card key={seg.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{seg.name}</CardTitle>
                  <Badge variant={seg.active ? "success" : "muted"}>{seg.active ? "Ativo" : "Inativo"}</Badge>
                </div>
                <CardDescription>{seg.description}</CardDescription>
                {(() => {
                  const free = freeBySegment.get(seg.id) ?? 0;
                  return free > 0 ? (
                    <p className="text-xs text-muted-foreground">{free} horário(s) livre(s) para as famílias.</p>
                  ) : (
                    <p className="text-xs font-medium text-destructive">
                      Nenhum horário livre: as famílias não conseguem agendar neste segmento. Libere horários em Disponibilidade.
                    </p>
                  );
                })()}
              </CardHeader>
              <CardContent className="space-y-5">
                <ActionForm action={setSegmentPsychologistsAction} className="space-y-3">
                  <input type="hidden" name="segmentId" value={seg.id} />
                  <p className="text-sm font-medium">Psicólogas responsáveis</p>
                  {psychologists.length === 0 && <p className="text-sm text-muted-foreground">Cadastre psicólogas primeiro.</p>}
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {psychologists.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="psychologistIds" value={p.id} defaultChecked={assigned.has(p.id)} className={checkbox} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                  <SubmitButton size="sm">Salvar psicólogas</SubmitButton>
                </ActionForm>

                <details className="border-t pt-4">
                  <summary className="cursor-pointer text-sm font-medium text-primary">Editar segmento</summary>
                  <ActionForm action={updateSegmentAction} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={seg.id} />
                    <Field label="Nome"><Input name="name" defaultValue={seg.name} required /></Field>
                    <Field label="Descrição"><Input name="description" defaultValue={seg.description ?? ""} /></Field>
                    <Field label="Ordem de exibição"><Input name="sortOrder" type="number" min={0} max={99} defaultValue={seg.sortOrder} /></Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={seg.active} className={checkbox} /> Ativo (visível para as famílias)
                    </label>
                    <SubmitButton size="sm">Salvar</SubmitButton>
                  </ActionForm>
                </details>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo segmento</CardTitle>
          <CardDescription>Use apenas se a escola criar um novo segmento além dos três iniciais.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createSegmentAction} resetOnSuccess className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <Field label="Nome" className="sm:col-span-2"><Input name="name" required /></Field>
            <Field label="Descrição"><Input name="description" /></Field>
            <Field label="Ordem"><Input name="sortOrder" type="number" min={0} max={99} defaultValue={5} /></Field>
            <SubmitButton className="sm:col-span-4 sm:w-fit">Criar segmento</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
