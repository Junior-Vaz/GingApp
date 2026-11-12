import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TrophyIcon } from "./icons";
import { categoryHasLive } from "@/lib/chaveamento/selectors";
import type { PublicCategory } from "@/lib/chaveamento/types";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export interface CategoryTabsProps {
  categories: readonly PublicCategory[];
  selectedId: number | null;
  /** Chamado quando a PESSOA escolhe a aba (toque/teclado): no modo telão isso pausa o rodízio. */
  onSelect: (categoryId: number) => void;
}

/**
 * Abas das categorias: chips de 44 px que rolam na horizontal (com esmaecido nas bordas que ainda têm conteúdo), a categoria
 * escolhida fica centralizada e quem tem luta ao vivo ganha o ponto + o texto "AO VIVO" (nunca só cor). Fixa no topo ao rolar
 * a página no celular (ver CSS).
 */
export function CategoryTabs({ categories, selectedId, onSelect }: CategoryTabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [edges, setEdges] = useState({ start: false, end: false });

  const updateEdges = useCallback((): void => {
    const el = listRef.current;
    if (!el) return;
    const next = { start: el.scrollLeft > 4, end: el.scrollLeft < el.scrollWidth - el.clientWidth - 4 };
    setEdges((previous) => (previous.start === next.start && previous.end === next.end ? previous : next));
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateEdges, categories.length]);

  // A categoria escolhida (por toque, busca ou link) fica no centro dos chips.
  useEffect(() => {
    const list = listRef.current;
    const tab = selectedId === null ? null : list?.querySelector<HTMLElement>(`[data-category-id="${selectedId}"]`);
    if (!list || !tab) return;
    const left = Math.max(0, tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2);
    try {
      list.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
    } catch {
      list.scrollLeft = left;
    }
  }, [selectedId, reducedMotion]);

  if (categories.length <= 1) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = categories.findIndex((c) => c.id === selectedId);
    const last = categories.length - 1;
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowRight" ? (index + 1) % categories.length : (index - 1 + categories.length) % categories.length;
    const next = categories[target];
    if (!next) return;
    onSelect(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-category-id="${next.id}"]`)?.focus();
  };

  return (
    <div className="cv-tabs-bar" data-edge-start={edges.start ? "1" : undefined} data-edge-end={edges.end ? "1" : undefined}>
      <div className="cv-tabs" role="tablist" aria-label="Categorias" ref={listRef} onKeyDown={onKeyDown} onScroll={updateEdges}>
        {categories.map((category) => {
          const selected = category.id === selectedId;
          const live = categoryHasLive(category);
          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              className="cv-tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              data-category-id={category.id}
              data-live={live ? "1" : undefined}
              title={category.name}
              onClick={() => onSelect(category.id)}
            >
              {live && <span className="cv-dot" aria-hidden="true" />}
              <span className="cv-tab-name">{category.name}</span>
              {live && <span className="sr-only"> (luta ao vivo)</span>}
              {live && (
                <span className="cv-tab-live" aria-hidden="true">
                  AO VIVO
                </span>
              )}
              {category.status === "FINISHED" && (
                <span className="cv-tab-done">
                  <TrophyIcon aria-hidden="true" /> encerrada
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
