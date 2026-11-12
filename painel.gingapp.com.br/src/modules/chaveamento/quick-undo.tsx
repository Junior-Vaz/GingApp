import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "./announce-context";
import { useUndoMatch } from "./api";
import { QUICK_UNDO_MS, QuickUndoContext, useQuickUndo, type QuickUndoApi, type QuickUndoEntry } from "./quick-undo-context";
import { shortcutKey, shouldIgnoreShortcut } from "./shortcuts";

/**
 * Guarda o ÚLTIMO resultado salvo por `QUICK_UNDO_MS` (10 s): enquanto vale, o desfazer é imediato (barra "Resultado
 * registrado · DESFAZER"); passada a janela, o desfazer normal continua pedindo confirmação.
 */
export function QuickUndoProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<QuickUndoEntry | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clear();
    setCurrent(null);
  }, [clear]);

  const offer = useCallback<QuickUndoApi["offer"]>(
    (entry) => {
      clear();
      counter.current += 1;
      setCurrent({ ...entry, id: counter.current });
      timer.current = setTimeout(() => {
        timer.current = null;
        setCurrent(null);
      }, QUICK_UNDO_MS);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  const value = useMemo<QuickUndoApi>(() => ({ current, offer, dismiss }), [current, offer, dismiss]);
  return <QuickUndoContext.Provider value={value}>{children}</QuickUndoContext.Provider>;
}

/** Barra fixa "Resultado registrado · DESFAZER" (acima da barra inferior do celular). */
export function UndoBar({ eventId }: { eventId: number }) {
  const { current, dismiss } = useQuickUndo();
  const undo = useUndoMatch(eventId);
  const announce = useAnnounce();

  const run = useCallback(async () => {
    if (!current || undo.isPending) return;
    const entry = current;
    dismiss();
    try {
      await undo.mutateAsync(entry.matchId);
      announce(`Resultado desfeito: ${entry.label}.`);
    } catch {
      /* o toast do hook já mostrou a mensagem do `code` (ex.: a próxima luta já começou) */
    }
  }, [announce, current, dismiss, undo]);

  // U desfaz na hora enquanto a janela vale (no desktop).
  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event) || shortcutKey(event) !== "u") return;
      event.preventDefault();
      void run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, run]);

  if (!current) return null;
  return (
    <div
      role="region"
      aria-label="Desfazer o último resultado"
      data-testid="undo-bar"
      className="chv-rise fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[60] mx-auto w-auto max-w-md overflow-hidden rounded-xl border border-emerald-700/40 bg-card shadow-xl md:bottom-6"
    >
      <div className="flex items-center gap-3 p-3">
        <CheckCircle2 className="size-6 shrink-0 text-emerald-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">Resultado registrado</p>
          <p className="truncate text-xs text-muted-foreground">{current.label}</p>
        </div>
        <Button type="button" variant="default" size="lg" className="h-11 shrink-0 gap-1.5 font-extrabold tracking-wide md:h-10" onClick={() => void run()}>
          <Undo2 /> DESFAZER
        </Button>
      </div>
      {/* contagem regressiva: só transform (desligada com movimento reduzido) */}
      <div className="h-1 bg-muted" aria-hidden>
        <div key={current.id} className="chv-countdown h-full origin-left bg-emerald-600" style={{ animationDuration: `${String(QUICK_UNDO_MS)}ms` }} />
      </div>
    </div>
  );
}
