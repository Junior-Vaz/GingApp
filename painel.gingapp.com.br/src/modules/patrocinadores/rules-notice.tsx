import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { SPONSOR_NOTICES } from "./sponsor-utils";

/** Avisos fixos das regras de ouro (texto exato do contrato). Aparecem na lista de campanhas e no formulário. */
export function RulesNotice({ className }: { className?: string }) {
  return (
    <section
      aria-label="Regras dos patrocinadores"
      data-testid="rules-notice"
      className={cn("rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950", className)}
    >
      <p className="mb-1.5 flex items-center gap-2 font-semibold">
        <Info className="size-4 shrink-0" aria-hidden /> Regras importantes
      </p>
      <ul className="list-disc space-y-0.5 pl-6">
        <li>{SPONSOR_NOTICES.minors}</li>
        <li>{SPONSOR_NOTICES.badge}</li>
        <li>{SPONSOR_NOTICES.activeLimit}</li>
        <li>{SPONSOR_NOTICES.prohibited}</li>
      </ul>
    </section>
  );
}
