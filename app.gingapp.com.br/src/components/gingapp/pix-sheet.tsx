import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Copy, ExternalLink, Loader2, QrCode, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { dayOnly, fmt, formatCurrency, toDate } from "@/lib/format";
import type { FinancialRecord } from "@/lib/queries";
import {
  PIX_POLL_MAX_MS,
  PIX_POLL_MS,
  formatPixExpiry,
  pixErrorMessage,
  qrImageSrc,
  useGeneratePix,
  usePixPolling,
  useRefreshFinance,
  type PixCharge,
} from "@/lib/pix";

/** QR do Pix: o PNG do Mercado Pago quando vem; senão gerado aqui a partir do copia e cola (lib `qrcode`). */
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
  if (!src) return <div className="mx-auto size-56 animate-pulse rounded-md bg-muted" aria-hidden />;
  return <img src={src} alt="QR Code do Pix" width={224} height={224} className="mx-auto size-56 rounded-md border bg-white p-2" />;
}

/**
 * "Pagar com Pix" de uma mensalidade em aberto: gera (ou reaproveita) o Pix, mostra QR + copia e cola e acompanha
 * o pagamento por polling leve (5 s por até 3 min; pausa com a aba oculta e para ao fechar). Ao virar PAID mostra
 * "Pagamento confirmado" e refaz o financeiro. No celular é uma folha ancorada no rodapé.
 */
export function PixSheet({
  record,
  onClose,
  pollIntervalMs = PIX_POLL_MS,
  pollMaxMs = PIX_POLL_MAX_MS,
}: {
  record: FinancialRecord | null;
  onClose: () => void;
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

  useEffect(() => {
    if (recordId === null) return;
    setPollStopped(false);
    generatePix(recordId);
    return () => resetGenerate();
  }, [recordId, generatePix, resetGenerate]);

  const charge = poll.data ?? generate.data;
  const status = charge?.status;

  useEffect(() => {
    if (status !== "PENDING") return;
    const timer = setTimeout(() => setPollStopped(true), pollMaxMs);
    return () => clearTimeout(timer);
  }, [status, charge?.generatedAt, pollMaxMs]);

  useEffect(() => {
    if (charge?.status === "PAID" && paidNotified.current !== charge.financeRecordId) {
      paidNotified.current = charge.financeRecordId;
      toast.success("Pagamento confirmado!");
      refresh();
    }
  }, [charge?.status, charge?.financeRecordId, refresh]);

  const expired = charge !== undefined && (status === "EXPIRED" || (status === "PENDING" && toDate(charge.expiresAt).getTime() < Date.now()));

  async function copy() {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.qrCode);
      toast.success("Código Pix copiado. Agora cole no app do seu banco.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  }

  const errorText = generate.error ? pixErrorMessage(generate.error) : null;

  return (
    <Dialog open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="pix-sheet"
        className="max-h-[92dvh] overflow-y-auto max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="pr-6">
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5" aria-hidden /> Pagar com Pix
          </DialogTitle>
          <DialogDescription>
            {record ? `${record.description} · vence em ${fmt(dayOnly(record.dueDate), "dd/MM/yyyy")}` : "Mensalidade"}
          </DialogDescription>
        </div>

        {errorText ? (
          <div className="grid gap-3">
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{errorText}</span>
            </p>
            {recordId !== null && (
              <Button variant="outline" disabled={generate.isPending} onClick={() => generatePix(recordId)}>
                Tentar de novo
              </Button>
            )}
          </div>
        ) : !charge ? (
          <div className="grid gap-3" aria-busy="true" data-testid="pix-loading">
            <div className="mx-auto size-56 animate-pulse rounded-md bg-muted" />
            <p className="text-center text-sm text-muted-foreground">Gerando o Pix…</p>
          </div>
        ) : status === "PAID" ? (
          <div role="status" data-testid="pix-paid" className="grid justify-items-center gap-2 py-4 text-center">
            <CheckCircle2 className="size-14 text-emerald-600" aria-hidden />
            <p className="text-lg font-semibold">Pagamento confirmado</p>
            <p className="text-sm text-muted-foreground">Recebemos {formatCurrency(charge.amountCents)}. Obrigado!</p>
            <Button className="mt-2" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : expired || status === "CANCELLED" ? (
          <div className="grid gap-3">
            <p role="status" data-testid="pix-expired" className="rounded-lg bg-secondary px-3 py-2.5 text-sm">
              {status === "CANCELLED" ? "Este Pix foi cancelado." : `Este Pix expirou em ${formatPixExpiry(charge.expiresAt)}.`}
            </p>
            <Button disabled={generate.isPending} onClick={() => generatePix(charge.financeRecordId)}>
              {generate.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Gerar novo Pix
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <PixQr charge={charge} />
            <div className="text-center">
              <p className="text-2xl font-bold" data-testid="pix-amount">
                {formatCurrency(charge.amountCents)}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="pix-expiry">
                Válido até {formatPixExpiry(charge.expiresAt)}
              </p>
            </div>
            <ol className="grid gap-1 rounded-lg bg-secondary px-4 py-3 text-xs text-muted-foreground" data-testid="pix-steps">
              <li>1. Abra o app do seu banco.</li>
              <li>2. Escolha Pix e depois “Pix Copia e Cola” (ou leia o QR Code).</li>
              <li>3. Cole o código, confira o valor e confirme.</li>
            </ol>
            <div>
              <label className="field-label" htmlFor="pix-code">
                Pix copia e cola
              </label>
              <input
                id="pix-code"
                className="profile-input font-mono text-xs"
                readOnly
                value={charge.qrCode}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <Button className="min-h-11" onClick={() => void copy()}>
              <Copy /> Copiar código Pix
            </Button>
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
                  <Button variant="ghost" size="sm" disabled={poll.isFetching} onClick={() => void poll.refetch()}>
                    <RefreshCw /> Já paguei, verificar
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
      </DialogContent>
    </Dialog>
  );
}
