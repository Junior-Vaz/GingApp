import { Badge } from "@/components/ui/badge";
import { HEX_COLOR, readableTextColor, roleIcon } from "@/lib/role-style";
import { sortBadges, type RoleBadgeData } from "@/lib/staff-roles";
import { cn } from "@/lib/utils";

/** Dados mínimos para desenhar um selo (um `RoleBadgeData` ou um cargo do grupo, prévia do editor). */
export type RoleBadgeLike = Pick<RoleBadgeData, "name" | "color" | "icon"> & Partial<Pick<RoleBadgeData, "id" | "accessRole">>;

/**
 * Selo de UM cargo: nome + cor + ícone (lucide pelo nome kebab). Sem cor, selo neutro; sem ícone, só o nome. A cor
 * é o fundo e o texto escolhe preto/branco pelo contraste.
 */
export function RoleBadge({ badge, className }: { badge: RoleBadgeLike; className?: string | undefined }) {
  const Icon = roleIcon(badge.icon);
  const color = badge.color && HEX_COLOR.test(badge.color) ? badge.color : null;
  return (
    <Badge
      variant={color ? "default" : "secondary"}
      data-role-badge={badge.name}
      data-role={badge.accessRole}
      data-color={color ?? undefined}
      className={cn("gap-1 [&_svg]:size-3 [&_svg]:shrink-0", color && "border-transparent", className)}
      style={color ? { backgroundColor: color, color: readableTextColor(color) } : undefined}
    >
      {Icon && <Icon aria-hidden="true" />}
      {badge.name}
    </Badge>
  );
}

/**
 * Selos dos cargos da pessoa, do maior para o menor rank (o primeiro é o selo principal). Sem cargos não desenha nada.
 */
export function RoleBadges({
  roles,
  className,
}: {
  roles: readonly RoleBadgeData[] | null | undefined;
  className?: string | undefined;
}) {
  const sorted = sortBadges(roles);
  if (sorted.length === 0) return null;
  return (
    <span data-testid="role-badges" className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {sorted.map((badge) => (
        <RoleBadge key={badge.id} badge={badge} />
      ))}
    </span>
  );
}
