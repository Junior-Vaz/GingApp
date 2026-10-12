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
import type { PersonPreview, StudentConflict } from "./aluno-conflito";
import { STUDENT_STATUS_LABEL } from "./schema";

const COMING_SOON =
  "A transferência (pedido ao outro grupo, aprovado pela própria pessoa) estará disponível em breve. Por enquanto, nada foi criado.";

function GroupLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
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
}: {
  conflict: StudentConflict | null;
  confirming: boolean;
  onClose: () => void;
  /** PERSON_ALREADY_IN_GROUP: abre a matrícula existente para editar/reativar. */
  onOpenExisting: (studentId: number) => void;
  /** POSSIBLE_DUPLICATE: "Cadastrar mesmo assim". */
  onConfirmNew: () => void;
}) {
  const [sameVerdict, setSameVerdict] = useState(false);
  useEffect(() => setSameVerdict(false), [conflict]);

  return (
    <Dialog open={conflict !== null} onOpenChange={(o) => !o && !confirming && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {conflict?.kind === "ALREADY_IN_GROUP" && (
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

        {conflict?.kind === "EXISTS_ELSEWHERE" && (
          <>
            <DialogHeader>
              <DialogTitle>Esta pessoa já tem ficha em outro grupo</DialogTitle>
              <DialogDescription>{COMING_SOON}</DialogDescription>
            </DialogHeader>
            <PersonPreviewCard person={conflict.person} />
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Fechar
              </Button>
            </DialogFooter>
          </>
        )}

        {conflict?.kind === "POSSIBLE_DUPLICATE" && !sameVerdict && (
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

        {conflict?.kind === "POSSIBLE_DUPLICATE" && sameVerdict && (
          <>
            <DialogHeader>
              <DialogTitle>Cadastro não criado</DialogTitle>
              <DialogDescription>{COMING_SOON}</DialogDescription>
            </DialogHeader>
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
