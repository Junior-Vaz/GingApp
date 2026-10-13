import { useEffect, useRef } from "react";
import { Check, Medal } from "lucide-react";
import { ropeLabel, type RopeSpec } from "@/lib/rope";
import type { Badge } from "@/lib/roles";
import { Rope } from "./rope";
import { RoleChip } from "./roles";

/** Cartão "Minha graduação": medalha à esquerda, textos e a CORDA vertical desenhada à direita (altura do cartão). */
export function GraduationCard({
  name,
  rope,
  subtitle,
  loading = false,
  role,
  label = "Minha graduação",
}: {
  /** Nome do nível atual; null = sem graduação. */
  name: string | null;
  rope: RopeSpec | null;
  subtitle: string;
  loading?: boolean;
  /** Cargo atual no grupo (selo principal, ex.: "Contramestre" com a cor do grupo); ausente para quem é só aluno. */
  role?: Badge | null;
  /** Rótulo do cartão; "Graduação de <nome>" quando um dependente está selecionado. */
  label?: string;
}) {
  return (
    <div className="grad-card" data-testid="graduation-card" aria-busy={loading || undefined}>
      <span className="grad-medal" aria-hidden="true">
        <Medal />
      </span>
      <div className="grad-text">
        <span className="grad-eyebrow">{label}</span>
        <h2>{name ?? (loading ? "Carregando…" : "Sem graduação")}</h2>
        <p>{subtitle}</p>
        {role && <RoleChip badge={role} className="mt-2" testId="journey-role" />}
      </div>
      {name && rope && <Rope {...rope} orientation="vertical" length={104} thickness={20} className="grad-rope" />}
    </div>
  );
}

export interface RulerLevel extends RopeSpec {
  id: number;
  name: string;
  order: number;
}

/**
 * Régua do sistema: todas as cordas em sequência (da mais baixa à mais alta). A atual fica destacada, as já
 * conquistadas ganham um check e as próximas aparecem esmaecidas.
 */
export function RopeRuler({ levels, currentOrder }: { levels: RulerLevel[]; currentOrder: number | null }) {
  const sorted = [...levels].sort((a, b) => a.order - b.order);
  const scroller = useRef<HTMLOListElement>(null);

  // Leva a corda atual para o centro da faixa (rolagem horizontal em telas estreitas).
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "center" });
  }, [currentOrder, sorted.length]);

  if (sorted.length === 0) return null;
  return (
    <ol className="rope-ruler" ref={scroller} aria-label="Cordas do sistema">
      {sorted.map((level) => {
        const state = currentOrder === null ? "next" : level.order < currentOrder ? "done" : level.order === currentOrder ? "current" : "next";
        return (
          <li
            key={level.id}
            className="rope-ruler-item"
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            title={`${level.name} — ${state === "done" ? "concluída" : state === "current" ? "sua corda atual" : "próxima"}`}
          >
            <span className="rope-ruler-rope">
              <Rope {...level} orientation="vertical" length={46} thickness={13} label={ropeLabel(level)} />
              {state === "done" && (
                <span className="rope-ruler-check" aria-label="Concluída" role="img">
                  <Check aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="rope-ruler-name">{level.name}</span>
          </li>
        );
      })}
    </ol>
  );
}
