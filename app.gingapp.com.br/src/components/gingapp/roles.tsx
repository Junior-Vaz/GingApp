import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAINEL_URL, badgeStyle, roleIcon, type Badge } from "@/lib/roles";

/** Selo de UM cargo do grupo: nome, cor e ícone definidos pelo grupo (sem cor/ícone: selo neutro só com o texto). */
export function RoleChip({ badge, className = "", testId }: { badge: Badge; className?: string; testId?: string }) {
  const Icon = roleIcon(badge.icon);
  return (
    <span
      className={`badge ${className}`.trim()}
      style={badgeStyle(badge.color)}
      data-testid={testId ?? `role-badge-${badge.slug}`}
      data-access-role={badge.accessRole}
    >
      {Icon && <Icon aria-hidden="true" className="size-3" />}
      {badge.name}
    </span>
  );
}

/** Selo(s) de cargo ("Contramestre", "Monitor"...) ao lado do nome. Sem cargo: não renderiza nada. */
export function RoleBadges({ roles, className = "" }: { roles: Badge[]; className?: string }) {
  if (roles.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`} data-testid="role-badges">
      {roles.map((role) => (
        <RoleChip key={role.slug} badge={role} />
      ))}
    </span>
  );
}

/** Atalho para o painel do grupo (nova aba). Só quem tem cargo vê; sem cargo: nada. */
export function PanelShortcut({ roles }: { roles: Badge[] }) {
  const top = roles[0];
  if (!top) return null;
  return (
    <section className="content-band" data-testid="panel-shortcut">
      <h2>Painel do grupo</h2>
      <p className="text-xs text-muted-foreground">Como {top.name.toLowerCase()}, você gerencia o grupo pelo painel.</p>
      <Button className="mt-3" variant="outline" size="sm" asChild>
        <a href={PAINEL_URL} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
          Abrir o painel do grupo
        </a>
      </Button>
    </section>
  );
}
