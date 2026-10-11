import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { NativeSelect } from "@/modules/alunos/native-select";
import { payDefaults, payFormSchema, type PayFormValues } from "./collection";
import { useFinanceActions } from "./finance-api";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type FinanceRecord } from "./finance-utils";

/**
 * Baixa rápida: já abre com hoje, PIX e o valor do lançamento — para o caso comum basta confirmar.
 * Data (não futura), forma de pagamento e valor pago (centavos) podem ser ajustados.
 */
export function PayDialog({ record, onClose }: { record: FinanceRecord | null; onClose: () => void }) {
  const { pay } = useFinanceActions();
  return (
    <FormDialog<PayFormValues>
      open={record !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Dar baixa"
      description={record ? `${record.description} — ${formatCurrency(record.amountCents)}` : undefined}
      schema={payFormSchema}
      defaultValues={record ? payDefaults(record) : { paidAt: "", paymentMethod: "PIX", amountReais: "" }}
      submitLabel="Confirmar baixa"
      onSubmit={(values) => pay.mutateAsync({ id: record!.id, values })}
    >
      {(form) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="paidAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data do pagamento</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="paymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Forma de pagamento</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {PAYMENT_METHOD_LABEL[method]}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="amountReais"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valor pago (R$)</FormLabel>
                <FormControl>
                  <Input inputMode="decimal" placeholder="0,00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </FormDialog>
  );
}
