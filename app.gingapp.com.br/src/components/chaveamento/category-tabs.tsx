import { useRef, type KeyboardEvent } from "react";
import { TrophyIcon } from "./icons";
import { categoryHasLive } from "@/lib/chaveamento/selectors";
import type { PublicCategory } from "@/lib/chaveamento/types";

export interface CategoryTabsProps {
  categories: readonly PublicCategory[];
  selectedId: number | null;
  /** Chamado quando a PESSOA escolhe a aba (toque/teclado): no modo telão isso pausa o rodízio. */
  onSelect: (categoryId: number) => void;
}

/** Abas das categorias (rolam na horizontal no celular). Quem tem luta ao vivo ganha o ponto "AO VIVO" (texto, não só cor). */
export function CategoryTabs({ categories, selectedId, onSelect }: CategoryTabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
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
    <div className="cv-tabs" role="tablist" aria-label="Categorias" ref={listRef} onKeyDown={onKeyDown}>
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
            onClick={() => onSelect(category.id)}
          >
            {live && <span className="cv-dot" aria-hidden="true" />}
            <span>{category.name}</span>
            {live && <span className="sr-only"> (luta ao vivo)</span>}
            {category.status === "FINISHED" && (
              <span className="cv-tab-done">
                <TrophyIcon aria-hidden="true" /> encerrada
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
