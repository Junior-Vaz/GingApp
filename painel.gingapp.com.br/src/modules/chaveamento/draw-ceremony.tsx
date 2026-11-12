import { useEffect, useState, type CSSProperties } from "react";
import { Dices, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompetitorPhoto } from "./competitor-photo";
import type { OperatorCompetitor } from "./types";
import "./chaveamento.css";

/** Duração total da cerimônia (embaralhar + revelar): fica abaixo de 2 s. */
export const CEREMONY_SHUFFLE_MS = 1400;
export const CEREMONY_TOTAL_MS = 1900;
const MAX_AVATARS = 12;

/** Vetores de deslocamento diferentes por avatar (determinísticos: nada de Math.random). */
const offset = (i: number): CSSProperties =>
  ({ "--dx": `${String(16 + ((i * 7) % 5) * 6)}px`, "--dy": `${String(-12 - ((i * 5) % 4) * 6)}px`, "--i": i }) as CSSProperties;

/**
 * Cerimônia curta do sorteio: os atletas "embaralham" e a chave é revelada (≤ 2 s, pulável por botão, Esc ou toque).
 * Só `transform`/`opacity`. Quem usa decide NÃO montar este componente com `prefers-reduced-motion`.
 */
export function DrawCeremony({ athletes, onDone }: { athletes: readonly OperatorCompetitor[]; onDone: () => void }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const reveal = setTimeout(() => setRevealed(true), CEREMONY_SHUFFLE_MS);
    const done = setTimeout(onDone, CEREMONY_TOTAL_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(done);
    };
  }, [onDone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const shown = athletes.slice(0, MAX_AVATARS);
  const extra = athletes.length - shown.length;
  return (
    <div className="chv-in fixed inset-0 z-[65] grid place-items-center bg-black/65 p-4" data-testid="draw-ceremony" role="status" aria-live="polite">
      <div className="grid w-[min(92vw,26rem)] justify-items-center gap-4 rounded-2xl border bg-card p-5 text-center shadow-2xl">
        <p className="flex items-center gap-2 text-lg font-extrabold">
          <Dices className="size-6 text-primary" aria-hidden /> {revealed ? "Chave sorteada!" : "Sorteando a chave…"}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 py-2" aria-hidden>
          {shown.map((c, i) => (
            <span key={c.id} className={revealed ? "chv-pop" : "chv-shuffle"} style={offset(i)}>
              <CompetitorPhoto name={c.displayName} photoUrl={c.photoUrl} group={c.groupName} id={c.id} size="lg" />
            </span>
          ))}
          {extra > 0 && <span className="grid size-12 place-items-center rounded-full bg-muted text-sm font-extrabold">+{extra}</span>}
        </div>
        <Button type="button" variant="outline" size="sm" autoFocus onClick={onDone}>
          <FastForward /> Pular
        </Button>
      </div>
    </div>
  );
}
