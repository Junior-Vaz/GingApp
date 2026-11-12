import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

import type { GuideStep } from "./setup-steps";

/** Passo a passo do operador: "Adicione atletas → Sorteie a chave → Inicie as lutas" (o passo atual fica em destaque). */
export function StepsGuide({ steps, current, className }: { steps: readonly GuideStep[]; current: number; className?: string }) {
  return (
    <ol className={cn("grid grid-cols-1 gap-2 sm:grid-flow-col sm:auto-cols-fr", className)} data-testid="steps-guide">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step.title}
            aria-current={active ? "step" : undefined}
            className={cn(
              "relative flex items-start gap-3 rounded-xl border p-3",
              active ? "border-primary bg-secondary" : done ? "border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/30" : "bg-card",
            )}
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full text-sm font-extrabold",
                done ? "bg-emerald-700 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <Check className="size-4" /> : index + 1}
            </span>
            <span className="min-w-0 text-sm leading-tight">
              <span className="block font-extrabold">{step.title}</span>
              {step.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{step.hint}</span>}
              <span className="sr-only">{done ? " (feito)" : active ? " (passo atual)" : " (depois)"}</span>
            </span>
            {index < steps.length - 1 && <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-muted-foreground sm:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
