import type { MouseEvent } from "react";
import { Trophy } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { chaveamentoHref } from "./helpers";

/** Botão "Chaveamento" da linha de eventos do tipo CAMPEONATO (abre /eventos/:id/chaveamento; Ctrl/Cmd = nova aba). */
export function ChaveamentoLink({ id, title }: { id: number; title: string }) {
  const navigate = useNavigate();
  const href = chaveamentoHref(id);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigate({ to: "/eventos/$id/chaveamento", params: { id: String(id) } });
  }

  return (
    <Button asChild variant="ghost" size="sm">
      <a href={href} onClick={onClick} aria-label={`Chaveamento de ${title}`}>
        <Trophy /> Chaveamento
      </a>
    </Button>
  );
}
