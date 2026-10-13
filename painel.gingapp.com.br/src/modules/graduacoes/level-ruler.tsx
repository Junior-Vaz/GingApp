import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { ropeOf } from "@/lib/rope";
import { cn } from "@/lib/utils";
import type { GraduationLevel, GraduationSystem } from "./graduacoes-api";
import { moveItem } from "./level-utils";

const byOrder = (levels: GraduationLevel[]) => [...levels].sort((a, b) => a.order - b.order);

interface LevelRulerProps {
  system: GraduationSystem;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  busy?: boolean;
  onEdit: (level: GraduationLevel) => void;
  onRemove: (level: GraduationLevel) => void;
  onDuplicate: (level: GraduationLevel) => void;
  /** Novos ids de nível na sequência desejada (PUT reorder). */
  onReorder: (systemId: number, orderedIds: number[]) => void;
}

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-md text-muted-foreground md:size-7 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";

/**
 * "Régua de cordas": faixa com todas as cordas do sistema lado a lado (legenda) e, abaixo, um cartão por nível
 * (corda + nome + ordem + alunos) que pode ser arrastado ou movido pelos botões subir/descer.
 */
export function LevelRuler({ system, canCreate, canEdit, canDelete, busy, onEdit, onRemove, onDuplicate, onReorder }: LevelRulerProps) {
  const levels = byOrder(system.levels);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    const next = moveItem(levels, from, to);
    if (next !== levels) onReorder(system.id, next.map((l) => l.id));
  };

  return (
    <div className="space-y-3">
      <div
        aria-hidden
        data-testid={`ruler-${system.id}`}
        className="flex gap-3 overflow-x-auto rounded-lg border bg-muted/40 px-3 py-3"
      >
        {levels.map((level) => (
          <div key={level.id} className="flex w-16 shrink-0 flex-col items-center gap-1" title={`${level.order}. ${level.name}`}>
            <RopeSwatch {...ropeOf(level)} size="md" orientation="vertical" decorative />
            <span
              title={level.name}
              className="line-clamp-2 w-full break-words text-center text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere]"
            >
              {level.name}
            </span>
          </div>
        ))}
      </div>

      <ul aria-label={`Níveis de ${system.name}`} className="grid gap-2 lg:grid-cols-2">
        {levels.map((level, index) => (
          <li
            key={level.id}
            draggable={canEdit}
            onDragStart={(event) => {
              setDragId(level.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(level.id));
            }}
            onDragOver={(event) => {
              if (dragId === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (overId !== level.id) setOverId(level.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = levels.findIndex((l) => l.id === dragId);
              setDragId(null);
              setOverId(null);
              if (from >= 0) move(from, index);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
            }}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors max-sm:flex-wrap",
              dragId === level.id && "opacity-50",
              overId === level.id && dragId !== level.id && "border-primary bg-primary/5",
            )}
          >
            {canEdit && <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-muted-foreground" />}
            <RopeSwatch {...ropeOf(level)} size="md" orientation="vertical" />
            <div className="min-w-0 flex-1">
              <p title={level.name} className="line-clamp-2 break-words text-sm font-medium [overflow-wrap:anywhere]">{level.name}</p>
              <p className="text-xs text-muted-foreground">
                Ordem {level.order}
                {typeof level.studentCount === "number" && level.studentCount > 0 && (
                  <> · {level.studentCount} {level.studentCount === 1 ? "aluno" : "alunos"}</>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end max-sm:w-full">
              {canEdit && (
                <>
                  <button type="button" className={iconButton} aria-label={`Subir nível ${level.name}`} disabled={busy || index === 0} onClick={() => move(index, index - 1)}>
                    <ChevronUp className="size-4" aria-hidden />
                  </button>
                  <button type="button" className={iconButton} aria-label={`Descer nível ${level.name}`} disabled={busy || index === levels.length - 1} onClick={() => move(index, index + 1)}>
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                  <button type="button" className={iconButton} aria-label={`Editar nível ${level.name}`} onClick={() => onEdit(level)}>
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                </>
              )}
              {canCreate && (
                <button type="button" className={iconButton} aria-label={`Duplicar nível ${level.name}`} disabled={busy} onClick={() => onDuplicate(level)}>
                  <Copy className="size-3.5" aria-hidden />
                </button>
              )}
              {canDelete && (
                <button type="button" className={cn(iconButton, "hover:text-destructive")} aria-label={`Remover nível ${level.name}`} onClick={() => onRemove(level)}>
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
