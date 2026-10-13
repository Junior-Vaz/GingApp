import { useEffect, useState } from "react";
import { BadgeCheck, ChevronDown } from "lucide-react";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { ropeOf } from "@/lib/rope";
import { STAFF_ROLE_LABEL, STAFF_ROLES, type StaffRole } from "@/lib/staff-roles";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useRoleRules, useSaveRoleRules, type GraduationLevel, type GraduationSystem, type RoleRule } from "./graduacoes-api";

/** Do menor para o maior cargo, como o Mestre pensa a carreira. */
const ROLES_ASCENDING: readonly StaffRole[] = [...STAFF_ROLES].reverse();

type Draft = Record<StaffRole, string>;
const EMPTY_DRAFT: Draft = { MESTRE: "", PROFESSOR: "", INSTRUTOR: "", MONITOR: "" };

/** Rascunho dos selects ("" = sem regra) a partir das regras do servidor; regra para nível que não existe mais vira "sem regra". */
function toDraft(rules: RoleRule[], levels: GraduationLevel[]): Draft {
  const draft = { ...EMPTY_DRAFT };
  for (const rule of rules) {
    if (levels.some((level) => level.order === rule.minLevelOrder)) draft[rule.role] = String(rule.minLevelOrder);
  }
  return draft;
}

function RulesForm({ system, canEdit }: { system: GraduationSystem; canEdit: boolean }) {
  const query = useRoleRules(system.id);
  const save = useSaveRoleRules(system.id);
  const levels = [...system.levels].sort((a, b) => a.order - b.order);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saved, setSaved] = useState<Draft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!query.data) return;
    const next = toDraft(Array.isArray(query.data.rules) ? query.data.rules : [], system.levels);
    setDraft(next);
    setSaved(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reinicia só quando chegam regras novas do servidor
  }, [query.data]);

  if (query.isLoading) return <Skeleton className="h-24 w-full" data-testid="role-rules-loading" />;
  if (query.error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive" data-testid="role-rules-error">
        {errorMessage(query.error, "Não foi possível carregar as regras de cargo.")}
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const dirty = ROLES_ASCENDING.some((role) => draft[role] !== saved[role]);

  function submit() {
    const rules = ROLES_ASCENDING.filter((role) => draft[role] !== "").map((role) => ({
      role,
      minLevelOrder: Number(draft[role]),
    }));
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
        {ROLES_ASCENDING.map((role) => {
          const selected = levels.find((level) => String(level.order) === draft[role]);
          return (
            <div key={role} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_auto]">
              <span className="text-sm font-medium">{STAFF_ROLE_LABEL[role]}</span>
              <NativeSelect
                aria-label={`Corda mínima de ${STAFF_ROLE_LABEL[role]} em ${system.name}`}
                value={draft[role]}
                disabled={!canEdit || save.isPending}
                onChange={(e) => setDraft((current) => ({ ...current, [role]: e.target.value }))}
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
 * "Cargos por corda": para cada cargo (Monitor, Instrutor, Professor, Mestre) o nível mínimo do sistema a partir do
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
