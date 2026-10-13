import { useEffect, useState, type ReactNode } from "react";
import { Award, Building2, CalendarDays, Layers, Mail, Phone, Wallet } from "lucide-react";
import { RoleBadges } from "@/components/painel/role-badges";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { RowActions, type MaybeRowAction } from "@/components/painel/row-actions";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { dayOnly, fmt, initials } from "@/lib/format";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { STUDENT_STATUS_LABEL, currentCordOf, isMinor, type Student } from "./schema";

/**
 * Bloco da FOTO do aluno: preenche toda a altura do card (object-cover) e se dissolve na cor do card com um fade
 * (gradiente transparente -> cor do card) — para a direita no desktop e para baixo no celular, sem corte duro.
 * Sem foto (ou foto quebrada): iniciais grandes sobre uma cor suave, com o mesmo fade.
 */
export function StudentCardPhoto({
  name,
  photo,
  compact = false,
}: {
  name: string;
  photo?: string | null | undefined;
  /** Celular: miniatura quadrada de cantos arredondados, com fade lateral discreto (o card compacto). */
  compact?: boolean;
}) {
  const src = imageSrc(photo?.trim());
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const hasPhoto = !!src && !failed;
  return (
    <div
      data-testid="student-card-photo"
      className={cn(
        "relative shrink-0 overflow-hidden bg-secondary",
        compact ? "size-[4.5rem] rounded-lg" : "h-28 w-full sm:h-auto sm:min-h-44 sm:w-44 lg:w-52",
      )}
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
          className={cn(
            "absolute inset-0 flex items-center justify-center font-display font-extrabold text-primary/70",
            compact ? "text-2xl" : "text-5xl",
          )}
        >
          {initials(name)}
        </span>
      )}
      {/* fade da foto para a cor do card: sem corte duro */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0",
          compact
            ? "bg-linear-to-r from-transparent from-75% to-card/40"
            : "bg-linear-to-b from-transparent from-45% to-card sm:bg-linear-to-r",
        )}
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

/** Ações que viram botão de ÍCONE (44px) no card compacto; as demais (Responsáveis, Promover, Inativar…) vão ao menu "⋯". */
const COMPACT_ICON_ACTIONS = ["edit", "ficha", "access"];

/**
 * Card COMPACTO do celular (< md), ~140px: foto quadrada à esquerda; à direita nome, selos pequenos e 2 linhas
 * (unidade · turmas / corda · mensalidade). Embaixo uma faixa com os botões de ícone (Editar, Ficha, Acesso), o menu
 * "⋯" com as demais ações e o contato numa linha só. Mesmas ações e permissões do card largo.
 */
function StudentCardCompact({
  student: s,
  unitName,
  billing,
  actionList,
}: {
  student: Student;
  unitName: string;
  billing: string | undefined;
  actionList: MaybeRowAction[];
}) {
  const cord = currentCordOf(s);
  const contact = s.phone || s.email;
  const classes = s.classNames && s.classNames.length > 0 ? s.classNames : null;
  // Editar sem o nome do aluno é ambíguo numa lista de botões iguais: no celular o nome acessível cita o aluno.
  const actions = actionList.map((a) =>
    a
      ? {
          ...a,
          primary: COMPACT_ICON_ACTIONS.includes(a.key),
          ariaLabel: a.ariaLabel ?? (a.key === "edit" ? `Editar ${s.name}` : undefined),
        }
      : a,
  );
  return (
    <article
      data-testid="student-card"
      data-compact="true"
      aria-label={`Aluno ${s.name}`}
      className={cn("overflow-hidden rounded-xl border bg-card shadow-(--shadow)", s.status !== "ACTIVE" && "opacity-90")}
    >
      <div className="flex gap-2.5 p-2">
        <StudentCardPhoto name={s.name} photo={s.photo} compact />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-0.5">
          <h3 className="line-clamp-1 break-words font-display text-[15px] font-extrabold leading-5">{s.name}</h3>
          <div className="flex max-h-5 flex-wrap items-center gap-1 overflow-hidden [&_[data-role-badge]]:px-1.5 [&_[data-role-badge]]:py-0 [&_[data-role-badge]]:text-[10px]">
            <Badge variant={s.status === "ACTIVE" ? "default" : "secondary"} className="px-1.5 py-0 text-[10px] leading-4">
              {STUDENT_STATUS_LABEL[s.status]}
            </Badge>
            <Badge variant={s.userId ? "default" : "secondary"} className="px-1.5 py-0 text-[10px] leading-4">
              {s.userId ? "Com acesso" : "Sem acesso"}
            </Badge>
            {isMinor(s.birthDate) && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px] leading-4">
                Menor
              </Badge>
            )}
            <RoleBadges roles={s.staffRoles} />
          </div>
          <p className="flex items-center gap-1.5 truncate text-xs leading-4" title={`Unidade: ${unitName}`}>
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Unidade: </span>
            <span className="truncate">
              {unitName}
              {classes ? ` · ${classes[0]}${classes.length > 1 ? ` +${classes.length - 1}` : ""}` : ""}
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-xs leading-4">
            <Award className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Corda atual: </span>
            {cord ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {cord.rope && <RopeSwatch {...cord.rope} size="sm" orientation="horizontal" />}
                <span className="truncate">{cord.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Sem corda</span>
            )}
            {billing !== undefined && (
              <span className="ml-auto shrink-0 pl-1 font-semibold" title="Mensalidade">
                <span className="sr-only">Mensalidade: </span>
                {billing}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pl-1 pr-3">
        <RowActions actions={actions} subject={s.name} />
        {contact && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" title={contact}>
            {s.phone ? <Phone className="size-3.5 shrink-0" aria-hidden /> : <Mail className="size-3.5 shrink-0" aria-hidden />}
            <span className="sr-only">{s.phone ? "Telefone" : "E-mail"}: </span>
            <span className="truncate">{contact}</span>
          </span>
        )}
      </div>
    </article>
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
  actionList,
}: {
  student: Student;
  unitName: string;
  /** Resumo da mensalidade; `undefined` = sem permissão financeira (não mostra a linha). */
  billing?: string | undefined;
  /** Ações como botões com texto (desktop). */
  actions: ReactNode;
  /** As MESMAS ações como lista: o celular (< md) as mostra como ícones + menu "⋯" no card compacto. */
  actionList?: MaybeRowAction[] | undefined;
}) {
  const isMobile = useIsMobile();
  if (isMobile && actionList) return <StudentCardCompact student={s} unitName={unitName} billing={billing} actionList={actionList} />;
  const contact = [s.phone, s.email].filter(Boolean);
  const cord = currentCordOf(s);
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
          {cord && (
            <Info icon={Award} label="Corda atual">
              <span className="inline-flex items-center gap-1.5">
                {cord.rope && <RopeSwatch {...cord.rope} size="sm" orientation="horizontal" />}
                {cord.name}
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
