import { useEffect, useState } from "react";
import { BadgeCheck, ChevronDown } from "lucide-react";
import { RoleBadge } from "@/components/painel/role-badges";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { ropeOf } from "@/lib/rope";
import type { RoleBadgeData } from "@/lib/staff-roles";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useGroupRoles, type GroupRole } from "@/modules/professores/roles-api";
import { useRoleRules, useSaveRoleRules, type GraduationLevel, type GraduationSystem, type RoleRule } from "./graduacoes-api";

/** Rascunho dos selects por cargo do grupo (`groupRoleId`; "" ou ausente = sem regra). */
type Draft = Record<number, string>;

/** Rascunho a partir das regras do servidor; regra para nível que não existe mais vira "sem regra". */
function toDraft(rules: RoleRule[], levels: GraduationLevel[]): Draft {
  const draft: Draft = {};
  for (const rule of rules) {
    if (levels.some((level) => level.order === rule.minLevelOrder)) draft[rule.groupRoleId] = String(rule.minLevelOrder);
  }
  return draft;
}

const sameDraft = (a: Draft, b: Draft, ids: number[]) => ids.every((id) => (a[id] ?? "") === (b[id] ?? ""));

/**
 * Linhas do formulário: os cargos ATIVOS do grupo (do menor para o maior rank, como o Mestre pensa a carreira) mais
 * os inativos que ainda têm regra salva (para a regra não sumir sem querer).
 */
function rowsOf(groupRoles: GroupRole[], rules: RoleRule[]): { id: number; badge: RoleBadgeData; active: boolean }[] {
  const rows = groupRoles.filter((role) => role.active).map((role) => ({ id: role.id, badge: role as RoleBadgeData, active: true }));
  const known = new Set(rows.map((row) => row.id));
  for (const rule of rules) {
    if (!known.has(rule.groupRoleId)) {
      known.add(rule.groupRoleId);
      rows.push({ id: rule.groupRoleId, badge: rule.groupRole, active: rule.groupRole.active });
    }
  }
  return rows.sort((a, b) => a.badge.rank - b.badge.rank);
}

function RulesForm({ system, canEdit }: { system: GraduationSystem; canEdit: boolean }) {
  const query = useRoleRules(system.id);
  const rolesQuery = useGroupRoles();
  const save = useSaveRoleRules(system.id);
  const levels = [...system.levels].sort((a, b) => a.order - b.order);
  const [draft, setDraft] = useState<Draft>({});
  const [saved, setSaved] = useState<Draft>({});

  useEffect(() => {
    if (!query.data) return;
    const next = toDraft(Array.isArray(query.data.rules) ? query.data.rules : [], system.levels);
    setDraft(next);
    setSaved(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reinicia só quando chegam regras novas do servidor
  }, [query.data]);

  if (query.isLoading || rolesQuery.isLoading) return <Skeleton className="h-24 w-full" data-testid="role-rules-loading" />;
  const loadError = query.error ?? rolesQuery.error;
  if (loadError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive" data-testid="role-rules-error">
        {errorMessage(loadError, "Não foi possível carregar as regras de cargo.")}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch();
            void rolesQuery.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const rows = rowsOf(rolesQuery.data ?? [], Array.isArray(query.data?.rules) ? query.data.rules : []);
  const ids = rows.map((row) => row.id);
  const dirty = !sameDraft(draft, saved, ids);

  function submit() {
    const rules = rows
      .filter((row) => (draft[row.id] ?? "") !== "")
      .map((row) => ({ groupRoleId: row.id, minLevelOrder: Number(draft[row.id]) }));
    save.mutate(rules);
  }

  return (
    <div className="grid gap-3" data-testid={`role-rules-${system.id}`}>
      <p className="text-sm text-muted-foreground">
        Escolha, para cada cargo, a corda mínima a partir da qual ele é possível. O sistema sugere a promoção de quem
        atingir a corda e o Mestre confirma em Equipe, em &quot;Sugestões de promoção&quot;.
        {!canEdit && " Só o Mestre altera estas regras."}
      </p>
      <div className="grid gap-2">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">O grupo ainda não tem cargos ativos. Crie-os em Equipe, em &quot;Cargos do grupo&quot;.</p>
        )}
        {rows.map((row) => {
          const selected = levels.find((level) => String(level.order) === (draft[row.id] ?? ""));
          return (
            <div key={row.id} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_auto]">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                <RoleBadge badge={row.badge} />
                {!row.active && <span className="text-xs font-normal text-muted-foreground">(inativo)</span>}
              </span>
              <NativeSelect
                aria-label={`Corda mínima de ${row.badge.name} em ${system.name}`}
                value={draft[row.id] ?? ""}
                disabled={!canEdit || save.isPending}
                onChange={(e) => setDraft((current) => ({ ...current, [row.id]: e.target.value }))}
              >
                <option value="">Sem regra</option>
                {levels.map((level) => (
                  <option key={level.id} value={String(level.order)}>
                    {level.name}
                  </option>
                ))}
              </NativeSelect>
              <span className="flex h-9 min-w-24 items-center">
                {selected ? (
                  <RopeSwatch {...ropeOf(selected)} size="md" orientation="horizontal" />
                ) : (
                  <span className="text-xs text-muted-foreground">Sem regra</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!dirty || save.isPending} onClick={() => setDraft(saved)}>
            Desfazer
          </Button>
          <Button type="button" size="sm" disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending ? "Salvando…" : "Salvar regras"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * "Cargos por corda": para cada cargo do grupo (Monitor, Instrutor, Contramestre...) o nível mínimo do sistema a partir do
 * qual ele é possível - ou "Sem regra". Painel recolhível (carrega as regras só ao abrir). Todos que veem graduações
 * leem; salvar (PUT) é só do Mestre.
 */
export function CargosPorCorda({ system, canEdit }: { system: GraduationSystem; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  if (system.levels.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-4 rounded-lg border bg-muted/30 p-3">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-2"
          aria-label={`Cargos por corda em ${system.name}`}
        >
          <BadgeCheck /> Cargos por corda
          <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <RulesForm system={system} canEdit={canEdit} />
      </CollapsibleContent>
    </Collapsible>
  );
}
