import { useEffect, useState } from "react";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { initials } from "@/lib/format";
import { ropeOf } from "@/lib/rope";
import { imageSrc } from "@/lib/uploads";
import { SolicitarTransferenciaForm } from "@/modules/transferencias/solicitar-transferencia-form";
import type { PersonPreview, StudentConflict } from "./aluno-conflito";
import { STUDENT_STATUS_LABEL } from "./schema";

const TRANSFER_INFO =
  "Para trazê-la ao seu grupo, solicite a transferência: a própria pessoa (ou o responsável, se for menor) precisa aprovar pelo app. Enquanto isso, nada foi criado.";
const NO_TRANSFER =
  "A transferência não está disponível para esta pessoa agora. Nenhum aluno novo foi criado.";

export function GroupLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const src = imageSrc(logoUrl?.trim());
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-0.5 pr-2.5 text-xs">
      <span
        aria-hidden="true"
        className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-[9px] font-bold text-primary"
      >
        {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
      </span>
      {name}
    </span>
  );
}

/** Cartão de uma pessoa que já tem ficha: foto, nome, apelido, grupos atuais com logo e a corda atual desenhada. */
export function PersonPreviewCard({ person }: { person: PersonPreview }) {
  return (
    <div data-testid="person-preview" className="flex gap-3 rounded-lg border bg-card p-3">
      <StudentAvatar name={person.name} photo={person.photo} className="size-14 text-base" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-semibold leading-tight">
          {person.name}
          {person.nickname && <span className="ml-1.5 font-normal text-muted-foreground">({person.nickname})</span>}
        </p>
        {person.currentGroups.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Grupos atuais">
            {person.currentGroups.map((g) => (
              <GroupLogo key={g.id} name={g.name} logoUrl={g.logoUrl} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Sem grupo atual.</p>
        )}
        {person.currentLevel ? (
          <p className="flex items-center gap-2 text-sm" aria-label="Corda atual">
            <RopeSwatch {...ropeOf(person.currentLevel)} size="sm" orientation="horizontal" />
            {person.currentLevel.name}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sem graduação registrada.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Diálogos dos 409 do cadastro de aluno (POST /students): já está no grupo, já tem ficha em outro grupo
 * e possível duplicado. Em nenhum deles o painel cria o aluno por conta própria: "Cadastrar mesmo assim"
 * (só no possível duplicado) reenvia o mesmo corpo com `confirmNew: true`.
 */
export function AlunoConflitoDialog({
  conflict,
  confirming,
  onClose,
  onOpenExisting,
  onConfirmNew,
  onTransferSent,
}: {
  conflict: StudentConflict | null;
  confirming: boolean;
  onClose: () => void;
  /** Pedido de transferência enviado (POST /transfers): o pai fecha o diálogo e o formulário de cadastro. */
  onTransferSent?: () => void;
  /** PERSON_ALREADY_IN_GROUP: abre a matrícula existente para editar/reativar. */
  onOpenExisting: (studentId: number) => void;
  /** POSSIBLE_DUPLICATE: "Cadastrar mesmo assim". */
  onConfirmNew: () => void;
}) {
  const [sameVerdict, setSameVerdict] = useState(false);
  // Pessoa para a qual o mini-formulário de transferência está aberto (null = ainda vendo o aviso).
  const [transferFor, setTransferFor] = useState<PersonPreview | null>(null);
  useEffect(() => {
    setSameVerdict(false);
    setTransferFor(null);
  }, [conflict]);

  return (
    <Dialog open={conflict !== null} onOpenChange={(o) => !o && !confirming && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {conflict && transferFor && (
          <>
            <DialogHeader>
              <DialogTitle>Solicitar transferência</DialogTitle>
              <DialogDescription>Pedido de transferência de {transferFor.name} para o seu grupo.</DialogDescription>
            </DialogHeader>
            <SolicitarTransferenciaForm
              personId={transferFor.personId}
              personName={transferFor.name}
              onBack={() => setTransferFor(null)}
              onSent={() => (onTransferSent ?? onClose)()}
            />
          </>
        )}

        {conflict?.kind === "ALREADY_IN_GROUP" && !transferFor && (
          <>
            <DialogHeader>
              <DialogTitle>Esta pessoa já está cadastrada no seu grupo</DialogTitle>
              <DialogDescription>
                {conflict.message} Situação atual: {STUDENT_STATUS_LABEL[conflict.studentStatus]}. Nenhum aluno novo foi
                criado.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button type="button" onClick={() => onOpenExisting(conflict.studentId)}>
                {conflict.studentStatus === "ACTIVE" ? "Abrir cadastro existente" : "Abrir cadastro para editar ou reativar"}
              </Button>
            </DialogFooter>
          </>
        )}

        {conflict?.kind === "EXISTS_ELSEWHERE" && !transferFor && (
          <>
            <DialogHeader>
              <DialogTitle>Esta pessoa já tem ficha em outro grupo</DialogTitle>
              <DialogDescription>
                {conflict.transferAvailable ? TRANSFER_INFO : NO_TRANSFER}
              </DialogDescription>
            </DialogHeader>
            <PersonPreviewCard person={conflict.person} />
            <DialogFooter>
              <Button type="button" variant={conflict.transferAvailable ? "outline" : "default"} onClick={onClose}>
                Fechar
              </Button>
              {conflict.transferAvailable && (
                <Button type="button" onClick={() => setTransferFor(conflict.person)}>
                  Solicitar transferência
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {conflict?.kind === "POSSIBLE_DUPLICATE" && !sameVerdict && !transferFor && (
          <>
            <DialogHeader>
              <DialogTitle>É a mesma pessoa?</DialogTitle>
              <DialogDescription>
                Encontramos {conflict.matches.length === 1 ? "uma pessoa parecida" : "pessoas parecidas"} já cadastrada
                {conflict.matches.length === 1 ? "" : "s"} no GingApp. Confira antes de criar um cadastro novo.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {conflict.matches.map((p) => (
                <PersonPreviewCard key={p.personId} person={p} />
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={confirming} onClick={() => setSameVerdict(true)}>
                É a mesma pessoa
              </Button>
              {conflict.canConfirmNew && (
                <Button type="button" disabled={confirming} onClick={onConfirmNew}>
                  {confirming ? "Cadastrando…" : "Cadastrar mesmo assim"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {conflict?.kind === "POSSIBLE_DUPLICATE" && sameVerdict && !transferFor && (
          <>
            <DialogHeader>
              <DialogTitle>Cadastro não criado</DialogTitle>
              <DialogDescription>
                {conflict.matches.length > 0 ? TRANSFER_INFO : NO_TRANSFER}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {conflict.matches.map((p) => (
                <div key={p.personId} className="grid gap-2">
                  <PersonPreviewCard person={p} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-self-end"
                    aria-label={`Solicitar transferência de ${p.name}`}
                    onClick={() => setTransferFor(p)}
                  >
                    Solicitar transferência
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Fechar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
