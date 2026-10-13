import type { HTMLAttributes } from "react";
import { Check } from "lucide-react";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { ropeOf } from "@/lib/rope";
import { cn } from "@/lib/utils";
import type { LevelOption } from "./graduacoes-api";

interface LevelSelectProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: LevelOption[];
  /** id do nível como string ("" = nenhum). */
  value: string;
  onChange: (value: string) => void;
}

/**
 * Seletor de nível em lista (um <select> nativo não mostra imagem): cada opção traz a corda desenhada,
 * o nome do nível e o sistema. Acessível como listbox; cada opção é um botão focável.
 */
export function LevelSelect({ options, value, onChange, className, ...rest }: LevelSelectProps) {
  if (options.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Nenhum nível disponível. Cadastre um sistema de graduação com níveis primeiro.
      </p>
    );
  }
  return (
    <div
      role="listbox"
      className={cn("max-h-64 divide-y overflow-y-auto rounded-md border", className)}
      {...rest}
    >
      {options.map((option) => {
        const selected = String(option.id) === value;
        return (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onChange(String(option.id))}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
              selected && "bg-primary/10",
            )}
          >
            <RopeSwatch {...ropeOf(option.level)} size="md" orientation="horizontal" />
            <span className="min-w-0 flex-1">
              <span title={option.level.name} className="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]">{option.level.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{option.systemName}</span>
            </span>
            {selected && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
