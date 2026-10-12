import type { MouseEvent } from "react";
import { QrCode } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { checkinHref, type CheckinKind } from "./checkin-api";

interface Props {
  kind: CheckinKind;
  id: number;
  label: string;
  ariaLabel?: string;
}

/** Botão que abre a tela de QR (SPA); com Ctrl/Cmd/botão do meio cai no link normal (nova aba). */
export function CheckinLink({ kind, id, label, ariaLabel }: Props) {
  const navigate = useNavigate();
  const href = checkinHref(kind, id);

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigate({ to: "/checkin/$kind/$id", params: { kind, id: String(id) } });
  }

  return (
    <Button asChild variant="ghost" size="sm">
      <a href={href} onClick={onClick} aria-label={ariaLabel ?? label}>
        <QrCode /> {label}
      </a>
    </Button>
  );
}
