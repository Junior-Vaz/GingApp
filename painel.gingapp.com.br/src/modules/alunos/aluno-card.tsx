import { useEffect, useState, type ReactNode } from "react";
import { Award, Building2, CalendarDays, Layers, Mail, Phone, Wallet } from "lucide-react";
import { RoleBadges } from "@/components/painel/role-badges";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { Badge } from "@/components/ui/badge";
import { dayOnly, fmt, initials } from "@/lib/format";
import { ropeOf } from "@/lib/rope";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { STUDENT_STATUS_LABEL, isMinor, type Student } from "./schema";

/**
 * Bloco da FOTO do aluno: preenche toda a altura do card (object-cover) e se dissolve na cor do card com um fade
 * (gradiente transparente -> cor do card) — para a direita no desktop e para baixo no celular, sem corte duro.
 * Sem foto (ou foto quebrada): iniciais grandes sobre uma cor suave, com o mesmo fade.
 */
export function StudentCardPhoto({ name, photo }: { name: string; photo?: string | null | undefined }) {
  const src = imageSrc(photo?.trim());
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const hasPhoto = !!src && !failed;
  return (
    <div
      data-testid="student-card-photo"
      className="relative h-40 w-full shrink-0 overflow-hidden bg-secondary sm:h-auto sm:min-h-44 sm:w-44 lg:w-52"
    >
      {hasPhoto ? (
        <img
          src={src}
          alt={`Foto de ${name}`}
          loading="lazy"
          className="absolute inset-0 size-full object-cover object-top"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          data-testid="student-card-initials"
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-display text-5xl font-extrabold text-primary/70"
        >
          {initials(name)}
        </span>
      )}
      {/* fade da foto para a cor do card: sem corte duro */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent from-45% to-card sm:bg-linear-to-r"
      />
    </div>
  );
}

function Info({ icon: Icon, children, label }: { icon: typeof Building2; children: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={label}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{label}: </span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Card horizontal largo do aluno (visão "Cards" de Alunos): foto grande à esquerda (topo no celular) e, à direita,
 * nome, situação, unidade/turmas/corda, contato, mensalidade e as ações (as mesmas da tabela, com as mesmas permissões).
 */
export function StudentCard({
  student: s,
  unitName,
  billing,
  actions,
}: {
  student: Student;
  unitName: string;
  /** Resumo da mensalidade; `undefined` = sem permissão financeira (não mostra a linha). */
  billing?: string | undefined;
  actions: ReactNode;
}) {
  const contact = [s.phone, s.email].filter(Boolean);
  return (
    <article
      data-testid="student-card"
      aria-label={`Aluno ${s.name}`}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card shadow-(--shadow) sm:min-h-44 sm:flex-row",
        s.status !== "ACTIVE" && "opacity-90",
      )}
    >
      <StudentCardPhoto name={s.name} photo={s.photo} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-4 sm:py-4 sm:pl-1 sm:pr-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h3 className="min-w-0 break-words font-display text-xl font-extrabold leading-tight">{s.name}</h3>
          {isMinor(s.birthDate) && <Badge variant="outline">Menor</Badge>}
          <Badge variant={s.status === "ACTIVE" ? "default" : "secondary"}>{STUDENT_STATUS_LABEL[s.status]}</Badge>
          <Badge variant={s.userId ? "default" : "secondary"}>{s.userId ? "Com acesso" : "Sem acesso"}</Badge>
          <RoleBadges roles={s.staffRoles} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Info icon={Building2} label="Unidade">
            {unitName}
          </Info>
          {s.classNames && s.classNames.length > 0 && (
            <Info icon={Layers} label="Turmas">
              {s.classNames.join(", ")}
            </Info>
          )}
          {(s.currentCord || s.currentLevel) && (
            <Info icon={Award} label="Corda atual">
              <span className="inline-flex items-center gap-1.5">
                {s.currentLevel && <RopeSwatch {...ropeOf(s.currentLevel)} size="sm" orientation="horizontal" />}
                {s.currentCord ?? s.currentLevel?.name}
              </span>
            </Info>
          )}
          {s.birthDate && (
            <Info icon={CalendarDays} label="Nascimento">
              {fmt(dayOnly(s.birthDate), "dd/MM/yyyy")}
            </Info>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {s.phone && (
            <Info icon={Phone} label="Telefone">
              {s.phone}
            </Info>
          )}
          {s.email && (
            <Info icon={Mail} label="E-mail">
              {s.email}
            </Info>
          )}
          {contact.length === 0 && <span className="text-muted-foreground">Sem contato cadastrado</span>}
          {billing !== undefined && (
            <Info icon={Wallet} label="Mensalidade">
              {billing}
            </Info>
          )}
        </div>

        <div className="-ml-2 mt-auto flex flex-wrap items-center gap-1 pt-1">{actions}</div>
      </div>
    </article>
  );
}
