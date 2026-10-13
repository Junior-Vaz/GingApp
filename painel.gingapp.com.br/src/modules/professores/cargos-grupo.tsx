import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowRightLeft, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { RoleBadge } from "@/components/painel/role-badges";
import { RowActions, type MaybeRowAction } from "@/components/painel/row-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { plural } from "@/lib/plural";
import { GROUP_ROLE_LIMIT, STAFF_ROLE_LABEL } from "@/lib/staff-roles";
import { useSessionUser } from "@/lib/session";
import { CargoDialog } from "./cargo-dialog";
import { CargoUsoDialog, type CargoUsoTarget } from "./cargo-uso-dialog";
import {
  errorCode,
  useGroupRoles,
  useReorderGroupRoles,
  useUpdateGroupRole,
  type GroupRole,
} from "./roles-api";

/**
 * "Cargos do grupo": cada grupo cria e edita os seus cargos (Contramestre, Formado, Monitor...), com selo (nome, cor,
 * ícone), perfil de acesso e rank. A lista vem do mais sênior para o menos e se reordena com subir/descer
 * (PUT /group-roles/reorder). Só o MESTRE vê as ações (criar, editar, ordenar, ativar, migrar, excluir); o servidor
 * também recusa os demais (403).
 */
export function CargosGrupo() {
  const isMestre = useSessionUser()?.role === "MESTRE";
  const query = useGroupRoles();
  const reorder = useReorderGroupRoles();
  const update = useUpdateGroupRole();
  const [editing, setEditing] = useState<GroupRole | "new" | null>(null);
  const [using, setUsing] = useState<CargoUsoTarget | null>(null);

  if (query.isLoading) {
    return (
      <div className="space-y-3" data-testid="group-roles-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center" data-testid="group-roles-error">
        <p className="text-sm text-destructive">{errorMessage(query.error, "Não foi possível carregar os cargos do grupo.")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const roles = query.data ?? [];
  const atLimit = roles.length >= GROUP_ROLE_LIMIT;

  /** Troca o cargo de posição e manda a ordem COMPLETA (todos os ids, do mais sênior ao menos). */
  function move(index: number, delta: -1 | 1) {
    const next = roles.map((role) => role.id);
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorder.mutate(next);
  }

  /** Ativar/inativar. Com gente no cargo o servidor recusa inativar: abre a migração em vez de falhar. */
  async function toggleActive(role: GroupRole) {
    if (role.active && role.peopleCount > 0) {
      setUsing({ role, mode: "deactivate" });
      return;
    }
    try {
      await update.mutateAsync({ id: role.id, data: { active: !role.active } });
    } catch (error) {
      if (errorCode(error) === "GROUP_ROLE_IN_USE") setUsing({ role, mode: "deactivate" });
    }
  }

  const actionsOf = (role: GroupRole): MaybeRowAction[] => [
    { key: "edit", label: "Editar", ariaLabel: `Editar cargo ${role.name}`, icon: Pencil, primary: true, onSelect: () => setEditing(role) },
    {
      key: "toggle",
      label: role.active ? "Inativar" : "Ativar",
      ariaLabel: `${role.active ? "Inativar" : "Ativar"} cargo ${role.name}`,
      icon: role.active ? PowerOff : Power,
      onSelect: () => void toggleActive(role),
    },
    role.peopleCount > 0 && {
      key: "migrate",
      label: "Migrar pessoas…",
      ariaLabel: `Migrar pessoas de ${role.name}`,
      icon: ArrowRightLeft,
      onSelect: () => setUsing({ role, mode: "migrate" }),
    },
    !role.isDefault && {
      key: "delete",
      label: "Excluir",
      ariaLabel: `Excluir cargo ${role.name}`,
      icon: Trash2,
      destructive: true,
      onSelect: () => setUsing({ role, mode: "delete" }),
    },
  ];

  return (
    <section className="grid gap-4" aria-label="Cargos do grupo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada cargo tem um <strong className="font-medium text-foreground">perfil de acesso</strong> (o que a pessoa pode fazer
          no painel) e um selo. A ordem define a senioridade: o cargo de maior rank é o selo principal da pessoa.
          {!isMestre && " Só o Mestre altera os cargos."}
        </p>
        {isMestre && (
          <div className="flex flex-col items-end gap-1">
            <Button onClick={() => setEditing("new")} disabled={atLimit}>
              <Plus /> Novo cargo
            </Button>
            <span className="text-xs text-muted-foreground">
              {roles.length} de {GROUP_ROLE_LIMIT} cargos
            </span>
          </div>
        )}
      </div>

      {roles.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground" data-testid="group-roles-empty">
          O grupo ainda não tem cargos.
        </div>
      ) : (
        <ul className="grid gap-2" aria-label="Lista de cargos do grupo">
          {roles.map((role, index) => (
            <li
              key={role.id}
              data-testid="group-role"
              data-active={role.active}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card p-3"
            >
              {isMestre && (
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Subir ${role.name}`}
                    title="Subir (mais sênior)"
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Descer ${role.name}`}
                    title="Descer (menos sênior)"
                    disabled={index === roles.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                <RoleBadge badge={role} className={role.active ? undefined : "opacity-50"} />
                <span className="text-sm text-muted-foreground">
                  Acesso: <span className="font-medium text-foreground">{STAFF_ROLE_LABEL[role.accessRole]}</span>
                </span>
                <span className="text-sm text-muted-foreground" data-testid="group-role-people">
                  {plural(role.peopleCount, "pessoa")}
                </span>
                <span className="text-xs text-muted-foreground">rank {role.rank}</span>
                {role.isDefault && <Badge variant="outline">Padrão</Badge>}
                {!role.active && <Badge variant="secondary">Inativo</Badge>}
              </div>
              {isMestre && <RowActions actions={actionsOf(role)} subject={role.name} />}
            </li>
          ))}
        </ul>
      )}

      {isMestre && (
        <>
          <CargoDialog target={editing} onClose={() => setEditing(null)} />
          <CargoUsoDialog target={using} roles={roles} onClose={() => setUsing(null)} />
        </>
      )}
    </section>
  );
}
