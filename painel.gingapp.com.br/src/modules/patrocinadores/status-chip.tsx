import { cn } from "@/lib/utils";
import { EFFECTIVE_STATUS_META, type EffectiveStatus } from "./sponsor-utils";

/** Chip do status efetivo da campanha. O texto sempre aparece (a cor nunca é a única informação). */
export function StatusChip({ status, className }: { status: EffectiveStatus; className?: string }) {
  const meta = EFFECTIVE_STATUS_META[status] ?? EFFECTIVE_STATUS_META.DRAFT;
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      title={meta.hint}
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", meta.classes, className)}
    >
      {EFFECTIVE_STATUS_META[status] ? meta.label : status}
    </span>
  );
}
