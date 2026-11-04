import { Badge } from "@/components/ui/badge";
import { checkinSourceLabel, type CheckinSource } from "./roster";

/**
 * Selo discreto "Check-in por GPS" / "Check-in por QR" ao lado de quem registrou a própria presença no app.
 * Sem origem (chamada manual do professor) não mostra nada.
 */
export function CheckinSourceBadge({ source }: { source: CheckinSource | null | undefined }) {
  const label = checkinSourceLabel(source);
  if (!label) return null;
  return (
    <Badge variant="outline" data-testid="checkin-source" className="shrink-0 px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
      {label}
    </Badge>
  );
}
