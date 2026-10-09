import { AUX_LIMIT } from "./reference";

/** Aviso discreto quando uma lista auxiliar (select) tem mais itens do que o teto de 200. */
export function AuxLimitNotice({ truncated, total, label }: { truncated: boolean; total: number; label: string }) {
  if (!truncated) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="aux-limit-notice">
      Mostrando os primeiros {AUX_LIMIT} de {total} {label}.
    </p>
  );
}