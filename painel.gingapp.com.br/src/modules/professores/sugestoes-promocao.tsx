import { useState } from "react";
import { Check } from "lucide-react";
import { RoleBadge, RoleBadges } from "@/components/painel/role-badges";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { ropeOf } from "@/lib/rope";
import { useRoleSuggestions, type RoleSuggestion } from "./roles-api";
import { useGrantRole } from "./use-grant-role";

const suggestionKey = (s: RoleSuggestion) => `${s.studentId}-${s.groupRoleId}`;

/**
 * "Sugestões de promoção": quem atingiu a corda mínima de um cargo (regras "Cargos por corda" do sistema de
 * graduação). O sistema SUGERE e o Mestre CONFIRMA (POST /roles/grant). Sem login ainda: pede e-mail + senha provisória.
 */
export function SugestoesPromocao() {
  const query = useRoleSuggestions();
  const { grant, isPending, loginDialog } = useGrantRole();
  const [busy, setBusy] = useState<string | null>(null);

  async function confirm(suggestion: RoleSuggestion) {
    setBusy(suggestionKey(suggestion));
    try {
      await grant({
        studentId: suggestion.studentId,
        groupRoleId: suggestion.groupRoleId,
        roleName: suggestion.role.name,
        name: suggestion.name,
      });
    } finally {
      setBusy(null);
    }
  }

  if (query.isLoading) {
    return (
      <div className="space-y-3" data-testid="suggestions-loading">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center" data-testid="suggestions-error">
        <p className="text-sm text-destructive">
          {errorMessage(query.error, "Não foi possível carregar as sugestões de promoção.")}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  const suggestions = query.data ?? [];
  if (suggestions.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground"
        data-testid="suggestions-empty"
      >
        Nenhuma sugestão de promoção no momento. Defina em Graduações, em &quot;Cargos por corda&quot;, a partir de qual corda
        cada cargo do grupo é possível.
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-3" aria-label="Sugestões de promoção">
        {suggestions.map((s) => (
          <li
            key={suggestionKey(s)}
            data-testid="suggestion"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-3"
          >
            <StudentAvatar name={s.name} photo={s.photo} className="size-11 text-sm" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold leading-tight">
                {s.name}
                {!s.hasLogin && <Badge variant="secondary">Sem login</Badge>}
                <RoleBadges roles={s.currentRoles} />
              </p>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                Atingiu
                <RopeSwatch {...ropeOf(s.level)} size="sm" orientation="horizontal" />
                <span className="font-medium text-foreground">{s.level.name}</span>
                <span>
                  {s.system.name} · {fmt(dayOnly(s.graduatedAt), "dd/MM/yyyy")}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm">
                Cargo sugerido: <RoleBadge badge={s.role} />
              </span>
              <Button
                size="sm"
                onClick={() => void confirm(s)}
                disabled={isPending}
                aria-label={`Confirmar ${s.role.name} para ${s.name}`}
              >
                <Check /> {busy === suggestionKey(s) ? "Confirmando…" : "Confirmar"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {loginDialog}
    </>
  );
}
