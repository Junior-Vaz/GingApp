import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnline } from "./page-activity";

/**
 * Aviso de falta de internet no lugar de trabalho do operador. Enquanto aparece, os botões de resultado ficam
 * desabilitados (nenhuma escrita é enfileirada em silêncio) e a consulta periódica fica parada; ao reconectar, tudo volta
 * e a mesa atualiza na hora.
 */
export function OfflineNotice({ className }: { className?: string }) {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      data-testid="chv-offline"
      className={cn("flex items-start gap-2 rounded-lg border-2 border-amber-500 bg-amber-50 p-3 text-sm font-bold text-amber-950", className)}
    >
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      Sem conexão — as ações ficam indisponíveis.
    </p>
  );
}
