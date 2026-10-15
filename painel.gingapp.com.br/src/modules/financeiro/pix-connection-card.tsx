import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Link2, Loader2, QrCode } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import { useMercadoPagoActions, useMercadoPagoStatus } from "./pix-api";

/**
 * "Receber por Pix" (só o MESTRE): conecta a conta Mercado Pago do PRÓPRIO grupo por OAuth. O dinheiro cai direto
 * na conta do grupo e o webhook do GingApp dá a baixa. Estados: carregando / erro / servidor sem Mercado Pago /
 * desconectado / conectado / acesso revogado ou com erro (reconectar).
 */
export function PixConnectionCard() {
  const status = useMercadoPagoStatus();
  const { connect, disconnect } = useMercadoPagoActions();
  const [disconnecting, setDisconnecting] = useState(false);
  const data = status.data;

  const shell = (children: ReactNode) => (
    <section aria-labelledby="pix-card-title" data-testid="pix-connection" className="rounded-lg border bg-card p-4 sm:p-6">
      <h2 id="pix-card-title" className="mb-3 flex items-center gap-2 text-base font-semibold">
        <QrCode className="size-5" aria-hidden /> Receber por Pix
      </h2>
      {children}
    </section>
  );

  if (status.isLoading) return shell(<Skeleton className="h-24 w-full" />);

  if (status.error || !data) {
    return shell(
      <div className="grid gap-3">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(status.error, "Não foi possível carregar a conexão com o Mercado Pago.")}
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
            Tentar de novo
          </Button>
        </div>
      </div>,
    );
  }

  if (!data.available) {
    return shell(
      <p role="status" data-testid="pix-unavailable" className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Pix automático ainda não está habilitado neste ambiente.
      </p>,
    );
  }

  const connectButton = (label: string) => (
    <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
      {connect.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} {label}
    </Button>
  );

  if (data.status === "REVOKED" || data.status === "ERROR") {
    return shell(
      <div className="grid gap-3" data-testid="pix-broken">
        <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          {data.status === "REVOKED"
            ? "O acesso ao Mercado Pago foi revogado. Enquanto isso, não é possível gerar Pix das mensalidades."
            : "A conexão com o Mercado Pago apresentou erro. Reconecte para voltar a gerar Pix das mensalidades."}
        </p>
        <div>{connectButton("Reconectar Mercado Pago")}</div>
      </div>,
    );
  }

  if (data.connected) {
    return shell(
      <div className="grid gap-3" data-testid="pix-connected">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" aria-hidden /> Conectado
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {data.liveMode ? "Produção" : "Teste"}
          </span>
          {data.connectedAt && (
            <span className="text-xs text-muted-foreground">desde {fmt(toDate(data.connectedAt), "dd/MM/yyyy")}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Os Pix das mensalidades caem direto na sua conta Mercado Pago e a baixa é automática. Use “Gerar Pix” nos
          lançamentos em aberto.
        </p>
        <div>
          <Button variant="outline" onClick={() => setDisconnecting(true)}>
            Desconectar
          </Button>
        </div>
        <ConfirmDialog
          open={disconnecting}
          onOpenChange={setDisconnecting}
          title="Desconectar o Mercado Pago?"
          description="Você deixa de gerar Pix das mensalidades. Pix já gerados continuam valendo no Mercado Pago, mas a baixa automática deixa de funcionar até reconectar."
          confirmLabel="Desconectar"
          onConfirm={() => disconnect.mutateAsync()}
        />
      </div>,
    );
  }

  return shell(
    <div className="grid gap-3" data-testid="pix-disconnected">
      <ul className="grid gap-1.5 text-sm text-muted-foreground">
        <li>O dinheiro cai direto na SUA conta Mercado Pago.</li>
        <li>Quando o aluno paga o Pix, o GingApp dá a baixa automaticamente.</li>
        <li>Eventuais tarifas seguem as condições da sua conta no Mercado Pago. Você pode desconectar quando quiser.</li>
      </ul>
      <div>{connectButton("Conectar Mercado Pago")}</div>
    </div>,
  );
}
