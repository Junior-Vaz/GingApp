import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAINEL_URL, STAFF_ROLE_LABEL } from "@/lib/roles";
import type { StaffRole } from "@/lib/session";

/** Selo(s) de cargo ("Mestre", "Professor"...) ao lado do nome. Sem cargo: não renderiza nada. */
export function RoleBadges({ roles, className = "" }: { roles: StaffRole[]; className?: string }) {
  if (roles.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`} data-testid="role-badges">
      {roles.map((role) => (
        <span className="badge" key={role} data-testid={`role-badge-${role}`}>
          {STAFF_ROLE_LABEL[role]}
        </span>
      ))}
    </span>
  );
}

/** Atalho para o painel do grupo (nova aba). Só quem tem cargo vê; sem cargo: nada. */
export function PanelShortcut({ roles }: { roles: StaffRole[] }) {
  if (roles.length === 0) return null;
  return (
    <section className="content-band" data-testid="panel-shortcut">
      <h2>Painel do grupo</h2>
      <p className="text-xs text-muted-foreground">Como {STAFF_ROLE_LABEL[roles[0]!].toLowerCase()}, você gerencia o grupo pelo painel.</p>
      <Button className="mt-3" variant="outline" size="sm" asChild>
        <a href={PAINEL_URL} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
          Abrir o painel do grupo
        </a>
      </Button>
    </section>
  );
}
