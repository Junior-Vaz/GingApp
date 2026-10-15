import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { CheckCircle2, Copy, ExternalLink, Loader2, QrCode, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toDate, formatCurrency } from "@/lib/format";
import type { FinanceRecord } from "./finance-utils";
import { PIX_POLL_MAX_MS, PIX_POLL_MS, useGeneratePix, usePixPolling, useRefreshFinance } from "./pix-api";
import {
  formatPixExpiry,
  pixErrorCode,
  pixErrorMessage,
  PIX_RECONNECT_CODES,
  pixShareText,
  pixWhatsAppUrl,
  qrImageSrc,
  type PixCharge,
} from "./pix";

/** QR do Pix: o PNG do Mercado Pago quando vem; senão gerado aqui a partir do copia e cola (lib `qrcode`, já usada nos certificados). */
function PixQr({ charge }: { charge: PixCharge }) {
  const direct = qrImageSrc(charge);
  const [generated, setGenerated] = useState<string | null>(null);
  useEffect(() => {
    if (direct) return;
    let alive = true;
    QRCode.toDataURL(charge.qrCode, { margin: 1, width: 224 })
      .then((url) => alive && setGenerated(url))
      .catch(() => alive && setGenerated(null));
    return () => {
      alive = false;
    };
  }, [direct, charge.qrCode]);
  const src = direct ?? generated;
  if (!src) return <Skeleton className="mx-auto size-56" />;
  return <img src={src} alt="QR Code do Pix" width={224} height={224} className="mx-auto size-56 rounded-md border bg-white p-2" />;
}

/**
 * "Gerar Pix" de um lançamento em aberto: POST /finance/:id/pix (idempotente), QR + copia e cola, e acompanhamento
 * por polling leve (GET /finance/:id/pix a cada 5 s por até 3 min; pausa com a aba oculta e para ao fechar).
 * Ao virar PAID mostra a confirmação e refaz lista, totais e inadimplentes.
 */
export function PixDialog({
  record,
  onClose,
  onGoConnect,
  pollIntervalMs = PIX_POLL_MS,
  pollMaxMs = PIX_POLL_MAX_MS,
}: {
  record: FinanceRecord | null;
  onClose: () => void;
  /** Atalho para a aba de conexão do Mercado Pago (quando o erro é MP_NOT_CONNECTED ou MP_ACCOUNT_ERROR). */
  onGoConnect?: () => void;
  pollIntervalMs?: number;
  pollMaxMs?: number;
}) {
  const recordId = record?.id ?? null;
  const generate = useGeneratePix();
  const { mutate: generatePix, reset: resetGenerate } = generate;
  const poll = usePixPolling(recordId, generate.data !== undefined, pollIntervalMs, pollMaxMs);
  const refresh = useRefreshFinance();
  const [pollStopped, setPollStopped] = useState(false);
  const paidNotified = useRef<number | null>(null);

  // Abriu o diálogo para um lançamento: gera (ou reaproveita) o Pix. Fechou: limpa para o próximo.
  useEffect(() => {
    if (recordId === null) return;
    setPollStopped(false);
    generatePix(recordId);
    return () => resetGenerate();
  }, [recordId, generatePix, resetGenerate]);

  const charge = poll.data ?? generate.data;
  const status = charge?.status;

  // Fim da janela de acompanhamento automático: avisa e oferece "Verificar agora".
  useEffect(() => {
    if (status !== "PENDING") return;
    const timer = setTimeout(() => setPollStopped(true), pollMaxMs);
    return () => clearTimeout(timer);
  }, [status, charge?.generatedAt, pollMaxMs]);

  useEffect(() => {
    if (charge?.status === "PAID" && paidNotified.current !== charge.financeRecordId) {
      paidNotified.current = charge.financeRecordId;
      toast.success("Pagamento confirmado pelo Pix.");
      refresh();
    }
  }, [charge?.status, charge?.financeRecordId, refresh]);

  const expired = charge !== undefined && (status === "EXPIRED" || (status === "PENDING" && toDate(charge.expiresAt).getTime() < Date.now()));
  const description = record?.description ?? "";

  async function copy() {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.qrCode);
      toast.success("Código Pix copiado.");
    } catch {
      toast.error("Não foi possível copiar o código. Selecione o texto e copie manualmente.");
    }
  }

  async function share() {
    if (!charge) return;
    const text = pixShareText(description, charge);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return; // o usuário só fechou a folha
      }
    }
    window.open(pixWhatsAppUrl(text), "_blank", "noopener,noreferrer");
  }

  const errorText = generate.error ? pixErrorMessage(generate.error) : null;
  const errorCode = pixErrorCode(generate.error);
  // Sem conexão ou conta do Mercado Pago com problema: o caminho é (re)conectar na aba "Receber por Pix".
  const notConnected = errorCode !== undefined && PIX_RECONNECT_CODES.includes(errorCode);

  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="pix-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5" aria-hidden /> Cobrar por Pix
          </DialogTitle>
          <DialogDescription>
            {record ? `${record.description}${record.student ? ` — ${record.student.name}` : ""}` : "Pix da mensalidade."}
          </DialogDescription>
        </DialogHeader>

        {errorText ? (
          <div className="grid gap-3">
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {errorText}
            </p>
            <div className="flex flex-wrap gap-2">
              {notConnected && onGoConnect && (
                <Button type="button" onClick={onGoConnect}>
                  {errorCode === "MP_ACCOUNT_ERROR" ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}
                </Button>
              )}
              {!notConnected && recordId !== null && (
                <Button type="button" variant="outline" disabled={generate.isPending} onClick={() => generatePix(recordId)}>
                  Tentar de novo
                </Button>
              )}
            </div>
          </div>
        ) : !charge ? (
          <div className="grid gap-3" aria-busy="true" data-testid="pix-loading">
            <Skeleton className="mx-auto size-56" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : status === "PAID" ? (
          <div role="status" data-testid="pix-paid" className="grid justify-items-center gap-2 py-4 text-center">
            <CheckCircle2 className="size-12 text-emerald-600" aria-hidden />
            <p className="text-lg font-semibold">Pagamento confirmado</p>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(charge.amountCents)} recebidos por Pix. A baixa já foi registrada automaticamente.
            </p>
          </div>
        ) : expired || status === "CANCELLED" ? (
          <div className="grid gap-3">
            <p role="status" data-testid="pix-expired" className="rounded-md border bg-muted/50 p-3 text-sm">
              {status === "CANCELLED" ? "Este Pix foi cancelado." : `Este Pix expirou em ${formatPixExpiry(charge.expiresAt)}.`}
            </p>
            <Button type="button" disabled={generate.isPending} onClick={() => generatePix(charge.financeRecordId)}>
              {generate.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Gerar novo Pix
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <PixQr charge={charge} />
            <div className="text-center">
              <p className="text-2xl font-bold" data-testid="pix-amount">
                {formatCurrency(charge.amountCents)}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="pix-expiry">
                Válido até {formatPixExpiry(charge.expiresAt)}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pix-code">Pix copia e cola</Label>
              <Input id="pix-code" readOnly value={charge.qrCode} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" onClick={() => void copy()}>
                <Copy /> Copiar código Pix
              </Button>
              <Button type="button" variant="outline" onClick={() => void share()}>
                <Send /> Enviar ao aluno
              </Button>
            </div>
            {charge.ticketUrl && (
              <a
                href={charge.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden /> Abrir no Mercado Pago
              </a>
            )}
            <p role="status" aria-live="polite" data-testid="pix-waiting" className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              {pollStopped ? (
                <>
                  Acompanhamento automático pausado.
                  <Button type="button" variant="ghost" size="sm" disabled={poll.isFetching} onClick={() => void poll.refetch()}>
                    <RefreshCw /> Verificar agora
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Aguardando o pagamento…
                </>
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
