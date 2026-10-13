import { Badge } from "@/components/ui/badge";
import { sortRoles, STAFF_ROLE_LABEL } from "@/lib/staff-roles";
import { cn } from "@/lib/utils";

/**
 * Selos de cargo da equipe (Mestre, Professor, Instrutor, Monitor), do maior para o menor. O maior cargo vem
 * preenchido (é o papel de acesso); os demais, em contorno. Sem cargos não desenha nada.
 */
export function RoleBadges({
  roles,
  className,
}: {
  roles: readonly string[] | null | undefined;
  className?: string | undefined;
}) {
  const sorted = sortRoles(roles);
  if (sorted.length === 0) return null;
  return (
    <span data-testid="role-badges" className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {sorted.map((role, index) => (
        <Badge key={role} variant={index === 0 ? "default" : "outline"} data-role={role}>
          {STAFF_ROLE_LABEL[role]}
        </Badge>
      ))}
    </span>
  );
}
