import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Uma ação da linha (já filtrada por permissão por quem monta a lista). */
export interface RowActionSpec {
  key: string;
  /** Texto da ação (tooltip do ícone, item do menu e rótulo no modo "cards"). */
  label: string;
  /** Nome acessível, quando precisa citar o registro (ex.: "Ficha de Ana"). Padrão: `label`. */
  ariaLabel?: string | undefined;
  icon: LucideIcon;
  onSelect: () => void;
  /** `true`: botão de ícone sempre visível; senão a ação vai para o menu "⋯". */
  primary?: boolean | undefined;
  destructive?: boolean | undefined;
}

export type MaybeRowAction = RowActionSpec | false | null | undefined;

const present = (actions: MaybeRowAction[]): RowActionSpec[] => actions.filter((a): a is RowActionSpec => !!a);

/**
 * Coluna "Ações" compacta: as ações principais como botões de ícone (title + aria-label) e as secundárias no menu "⋯",
 * tudo em UMA linha (flex-nowrap). Nenhuma ação some: só muda onde ela aparece.
 */
export function RowActions({ actions, subject }: { actions: MaybeRowAction[]; subject?: string | undefined }) {
  const list = present(actions);
  const primary = list.filter((a) => a.primary);
  const secondary = list.filter((a) => !a.primary);
  const moreLabel = subject ? `Mais ações de ${subject}` : "Mais ações";
  return (
    <div className="flex flex-nowrap items-center justify-end gap-0.5">
      {primary.map((a) => (
        <Button
          key={a.key}
          type="button"
          variant="ghost"
          size="icon"
          className={cn("md:size-8", a.destructive && "text-destructive hover:text-destructive")}
          title={a.label}
          aria-label={a.ariaLabel ?? a.label}
          onClick={a.onSelect}
        >
          <a.icon />
        </Button>
      ))}
      {secondary.length > 0 && (
        // modal=false: abrir um diálogo a partir de um item não deixa o body com pointer-events travado.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="md:size-8" title="Mais ações" aria-label={moreLabel}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {secondary.map((a) => (
              <DropdownMenuItem
                key={a.key}
                aria-label={a.ariaLabel ?? a.label}
                className={cn(a.destructive && "text-destructive focus:text-destructive")}
                onSelect={a.onSelect}
              >
                <a.icon /> {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** As mesmas ações como botões com texto (modo "cards": há espaço de sobra). */
export function ActionButtons({ actions }: { actions: MaybeRowAction[] }) {
  return (
    <>
      {present(actions).map((a) => (
        <Button key={a.key} type="button" variant="ghost" size="sm" aria-label={a.ariaLabel} onClick={a.onSelect}>
          <a.icon /> {a.label}
        </Button>
      ))}
    </>
  );
}
