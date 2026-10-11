import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useReceipt } from "./finance-api";
import { PAYMENT_METHOD_LABEL, formatDueDate } from "./finance-utils";

/**
 * Recibo de um lançamento PAGO (GET /finance/:id/receipt), pronto para imprimir: o botão chama
 * window.print() e o CSS de impressão (styles.css, `.receipt-printable`) deixa só o recibo na página.
 * Sem PDF/lib nova: o usuário escolhe "Salvar como PDF" no diálogo de impressão se quiser.
 */
export function ReceiptDialog({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const receipt = useReceipt(recordId);
  const data = receipt.data;
  const place = data ? [data.organization.city, data.organization.state].filter(Boolean).join(" / ") : "";

  return (
    <Dialog open={recordId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="receipt-printable max-w-xl" data-testid="receipt">
        <DialogTitle className="sr-only">Recibo</DialogTitle>
        <DialogDescription className="sr-only">Recibo de pagamento para impressão.</DialogDescription>
        {receipt.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : receipt.error || !data ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(receipt.error, "Não foi possível carregar o recibo.")}
          </p>
        ) : (
          <article className="grid gap-4 text-sm">
            <header className="flex items-start gap-3 border-b pb-3">
              {data.organization.logo && (
                <img src={data.organization.logo} alt="" className="size-14 rounded object-contain" />
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-bold">{data.organization.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {[data.organization.document && `CNPJ/CPF ${data.organization.document}`, data.organization.phone, data.organization.email, place]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-muted-foreground">Recibo nº</p>
                <p className="font-mono font-semibold" data-testid="receipt-number">
                  {data.number}
                </p>
              </div>
            </header>

            <p>
              Recebemos de <strong>{data.student?.name ?? "—"}</strong>
              {data.student?.document ? ` (documento ${data.student.document})` : ""} a quantia de{" "}
              <strong>{formatCurrency(data.paidCents)}</strong>, referente a <strong>{data.description}</strong>.
            </p>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">Valor do lançamento</dt>
                <dd>{formatCurrency(data.amountCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valor pago</dt>
                <dd className="font-semibold">{formatCurrency(data.paidCents)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vencimento</dt>
                <dd>{formatDueDate(data.dueDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pago em</dt>
                <dd>{formatDueDate(data.paidAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Forma de pagamento</dt>
                <dd>{data.paymentMethod ? PAYMENT_METHOD_LABEL[data.paymentMethod] : "—"}</dd>
              </div>
              {data.unit && (
                <div>
                  <dt className="text-xs text-muted-foreground">Unidade</dt>
                  <dd>{data.unit.name}</dd>
                </div>
              )}
            </dl>

            <div className="mt-8 border-t pt-2 text-center text-xs text-muted-foreground">
              {data.organization.name}
            </div>

            <div className="no-print flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button onClick={() => window.print()}>
                <Printer /> Imprimir
              </Button>
            </div>
          </article>
        )}
      </DialogContent>
    </Dialog>
  );
}
