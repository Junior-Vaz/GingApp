import { useEffect, type ReactNode } from "react";
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Form } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface FormDialogProps<T extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  /** Schema zod (sem transforms: entrada = saída). */
  schema: z.ZodType<T, z.ZodTypeDef, T>;
  defaultValues: DefaultValues<T>;
  /** Chamado com os valores validados. Se rejeitar, o diálogo continua aberto. */
  onSubmit: (values: T) => void | Promise<unknown>;
  /** Campos: use <FormField control={form.control} .../> do shadcn. */
  children: (form: UseFormReturn<T>) => ReactNode;
  submitLabel?: string;
  /** "dialog" (padrão) para formulários curtos; "sheet" para formulários longos. */
  as?: "dialog" | "sheet";
  /** Classes extras do conteúdo (ex.: `sm:max-w-2xl` para formulários largos). */
  className?: string | undefined;
}

/**
 * Formulário em Dialog/Sheet com react-hook-form + zod. Reinicia os valores a cada abertura
 * (passe `defaultValues` do registro em edição) e fecha sozinho quando `onSubmit` resolve.
 */
export function FormDialog<T extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  schema,
  defaultValues,
  onSubmit,
  children,
  submitLabel = "Salvar",
  as = "dialog",
  className,
}: FormDialogProps<T>) {
  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues });
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reinicia ao abrir
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch {
      // Erro já notificado pelo chamador (toast); mantém aberto.
    }
  });

  const body = (
    <Form {...form}>
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        className={cn("grid gap-4", as === "dialog" && "min-h-0 grid-rows-[minmax(0,1fr)_auto]")}
      >
        {/* Diálogo: só o corpo rola; o rodapé (Cancelar/Salvar) fica sempre visível. */}
        <div className={cn("grid content-start gap-4", as === "dialog" && "min-h-0 overflow-y-auto px-1 -mx-1")}>
          {children(form)}
        </div>
        <FooterButtons
          as={as}
          submitting={isSubmitting}
          submitLabel={submitLabel}
          onCancel={() => onOpenChange(false)}
        />
      </form>
    </Form>
  );

  if (as === "sheet") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className={cn("overflow-y-auto sm:max-w-md", className)}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description ?? "Preencha os dados abaixo."}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "Preencha os dados abaixo."}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function FooterButtons({
  as,
  submitting,
  submitLabel,
  onCancel,
}: {
  as: "dialog" | "sheet";
  submitting: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  const buttons = (
    <>
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
        Cancelar
      </Button>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Salvando…" : submitLabel}
      </Button>
    </>
  );
  return as === "sheet" ? (
    <SheetFooter className="sticky bottom-0 -mx-4 flex-row justify-end border-t bg-background px-4 py-3">{buttons}</SheetFooter>
  ) : (
    <DialogFooter className="border-t pt-4">{buttons}</DialogFooter>
  );
}
