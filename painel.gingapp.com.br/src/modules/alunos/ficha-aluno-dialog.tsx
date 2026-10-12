import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { ropeOf } from "@/lib/rope";
import { DOCUMENT_KIND_LABEL, useStudentFicha, type SharedFromOtherGroup } from "./ficha";
import { STUDENT_STATUS_LABEL, type Student } from "./schema";

const date = (iso: string) => fmt(dayOnly(iso), "dd/MM/yyyy");

function Section({ title, empty, children }: { title: string; empty?: string | undefined; children?: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children ?? <p className="text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

/**
 * "Histórico de outros grupos (compartilhado após transferência)": o que o grupo anterior tinha da pessoa e passou a
 * ser visível aqui depois que ela aprovou a transferência. Somente leitura; some quando não há nada compartilhado.
 */
function SharedHistory({ shared }: { shared: SharedFromOtherGroup[] }) {
  return (
    <section className="grid gap-2" data-testid="ficha-shared">
      <h3 className="text-sm font-semibold">Histórico de outros grupos (compartilhado após transferência)</h3>
      <p className="text-xs text-muted-foreground">Somente leitura: dados da matrícula anterior, liberados pela transferência.</p>
      <div className="grid gap-3">
        {shared.map((s) => (
          <div key={s.shareId} className="grid gap-2 rounded-lg border bg-card p-3" data-testid="ficha-shared-item">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{s.organization.name}</span>
              <span className="text-xs text-muted-foreground">
                de {date(s.since)} {s.until ? `até ${date(s.until)}` : "até hoje"}
                {s.leftReason ? ` · saída: ${s.leftReason}` : ""}
              </span>
            </div>

            {s.graduations.length > 0 && (
              <ul className="grid gap-1" aria-label={`Graduações em ${s.organization.name}`}>
                {s.graduations.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <RopeSwatch {...ropeOf(g.level)} size="sm" orientation="horizontal" />
                    <span className="font-medium">{g.level.name}</span>
                    <span className="text-muted-foreground">
                      {g.system.name} · {date(g.graduatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {s.attendanceByClass.length > 0 && (
              <ul className="grid gap-1" aria-label={`Frequência em ${s.organization.name}`}>
                {s.attendanceByClass.map((a) => (
                  <li key={a.class.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{a.class.name}</span>
                    <span className="text-muted-foreground">
                      {a.present} presença(s) · {a.absent} falta(s) · {a.total} no total
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {s.certificates.length > 0 && (
              <ul className="grid gap-1" aria-label={`Certificados em ${s.organization.name}`}>
                {s.certificates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{c.title}</span>
                    <span className="text-xs text-muted-foreground">{date(c.issuedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success("Código GingApp copiado.");
  } catch {
    toast.error("Não foi possível copiar. Selecione o código e copie manualmente.");
  }
}

/**
 * Ficha única do capoeirista (GET /students/:id/ficha): código GingApp (com botão copiar), CPF mascarado,
 * matrículas em cada grupo, graduações com a corda, presença por grupo e certificados. Se a rota falhar, mostra a
 * mensagem de erro dentro do diálogo, sem quebrar a página.
 */
export function FichaAlunoDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const ficha = useStudentFicha(student?.id);
  const data = ficha.data;

  return (
    <Dialog open={student !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ficha{student ? ` de ${student.name}` : ""}</DialogTitle>
          <DialogDescription>Ficha única do capoeirista: dados, matrículas, graduações, presença e certificados.</DialogDescription>
        </DialogHeader>

        {ficha.isLoading && <p className="text-sm text-muted-foreground">Carregando a ficha…</p>}
        {ficha.error && (
          <p role="alert" data-testid="ficha-error" className="text-sm text-destructive">
            {errorMessage(ficha.error, "Não foi possível carregar a ficha deste aluno.")}
          </p>
        )}

        {data && (
          <div className="grid gap-5" data-testid="ficha-content">
            <div className="flex items-center gap-3">
              <StudentAvatar name={data.person.name} photo={data.person.photo} className="size-14 text-base" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">
                  {data.person.name}
                  {data.person.nickname && (
                    <span className="ml-1.5 font-normal text-muted-foreground">({data.person.nickname})</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data.person.birthDate ? `Nascimento: ${date(data.person.birthDate)}` : "Nascimento não informado"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Código GingApp</p>
                <div className="flex items-center gap-2">
                  <code data-testid="ficha-code" className="font-mono text-base font-semibold tracking-wide">
                    {data.person.gingappCode}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Copiar código GingApp"
                    onClick={() => void copyCode(data.person.gingappCode)}
                  >
                    <Copy /> Copiar
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {data.person.documentKind ? DOCUMENT_KIND_LABEL[data.person.documentKind] : "CPF"}
                </p>
                <p data-testid="ficha-document" className="font-mono text-base">
                  {data.person.documentMasked ?? "Não informado"}
                </p>
              </div>
            </div>

            <Section title="Matrículas" empty="Nenhuma matrícula registrada.">
              {data.enrollments.length > 0 && (
                <ul className="grid gap-1.5">
                  {data.enrollments.map((e) => (
                    <li key={e.studentId} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border p-2 text-sm">
                      <span className="font-medium">{e.organization.name}</span>
                      {e.unit && <span className="text-muted-foreground">{e.unit.name}</span>}
                      <Badge variant={e.isCurrent ? "default" : "secondary"}>{STUDENT_STATUS_LABEL[e.status]}</Badge>
                      <span className="text-xs text-muted-foreground">
                        desde {date(e.since)}
                        {e.until ? ` até ${date(e.until)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Graduações" empty="Nenhuma graduação registrada.">
              {data.graduations.length > 0 && (
                <ul className="grid gap-1.5">
                  {data.graduations.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                      <RopeSwatch {...ropeOf(g.level)} size="sm" orientation="horizontal" />
                      <span className="font-medium">{g.level.name}</span>
                      <span className="text-muted-foreground">
                        {g.system.name} · {g.organization.name} · {date(g.graduatedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Presença por grupo" empty="Sem registros de presença.">
              {data.attendanceByGroup.length > 0 && (
                <ul className="grid gap-1.5">
                  {data.attendanceByGroup.map((a) => (
                    <li key={a.organization.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                      <span className="font-medium">{a.organization.name}</span>
                      <span className="text-muted-foreground">
                        {a.present} presença(s) · {a.absent} falta(s) · {a.total} no total
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Certificados" empty="Nenhum certificado emitido.">
              {data.certificates.length > 0 && (
                <ul className="grid gap-1.5">
                  {data.certificates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                      <span className="font-medium">{c.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.organization.name} · {date(c.issuedAt)} · {c.verificationCode}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {(data.sharedFromOtherGroups ?? []).length > 0 && (
              <SharedHistory shared={data.sharedFromOtherGroups} />
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
