import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { sponsorsErrorMessage, useSponsorMutations } from "./api";
import { SponsorImageField } from "./image-field";
import {
  SPONSOR_LIMITS,
  emptySponsorForm,
  serverFieldErrors,
  sponsorPayload,
  sponsorToForm,
  validateSponsorForm,
  type GroupSponsor,
  type SponsorFieldErrors,
  type SponsorFormState,
} from "./sponsor-utils";

const FIELDS = ["name", "logo", "contactName", "contactEmail", "contactPhone", "document", "notes"] as const;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface SponsorFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = novo patrocinador. */
  sponsor: GroupSponsor | null;
}

/** Criar/editar patrocinador do GRUPO (nome, logo, contato, documento, observações privadas). */
export function SponsorForm({ open, onOpenChange, sponsor }: SponsorFormProps) {
  const uid = useId();
  const { create, update } = useSponsorMutations();
  const [form, setForm] = useState<SponsorFormState>(emptySponsorForm);
  const [errors, setErrors] = useState<SponsorFieldErrors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setForm(sponsor ? sponsorToForm(sponsor) : emptySponsorForm());
    setErrors({});
    setGeneral([]);
  }, [open, sponsor]);

  const set = <K extends keyof SponsorFormState>(key: K, value: SponsorFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateSponsorForm(form);
    setErrors(found);
    setGeneral([]);
    const first = FIELDS.find((f) => found[f]);
    if (first) {
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    const body = sponsorPayload(form);
    const onSuccess = () => {
      toast.success(sponsor ? "Patrocinador atualizado." : "Patrocinador criado.");
      onOpenChange(false);
    };
    const onError = (error: unknown) => {
      const server = serverFieldErrors(error, FIELDS);
      const fieldErrors: SponsorFieldErrors = {};
      for (const [field, message] of Object.entries(server.fields)) fieldErrors[field as keyof SponsorFormState] = message;
      setErrors(fieldErrors);
      const known = Object.keys(server.fields).length > 0;
      const text = sponsorsErrorMessage(error, "Não foi possível salvar o patrocinador.");
      // Mensagens de negócio (409/403...) viram bloco; as de campo (400) ficam no campo.
      setGeneral(known ? server.general : [text]);
      if (!known) toast.error(text);
    };
    if (sponsor) update.mutate({ id: sponsor.id, body }, { onSuccess, onError });
    else create.mutate(body, { onSuccess, onError });
  }

  const id = (name: (typeof FIELDS)[number]) => `${uid}-${name}`;

  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent className="overflow-y-auto max-sm:w-full max-sm:p-4 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{sponsor ? "Editar patrocinador" : "Novo patrocinador"}</SheetTitle>
          <SheetDescription>
            Contato, documento e observações são privados do seu grupo: nunca aparecem para os alunos nem para o patrocinador.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} noValidate className="grid gap-4 pb-4 sm:px-4" data-testid="sponsor-form">
          {general.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive" data-testid="sponsor-form-error">
              {general.map((m) => (
                <p key={m}>{m}</p>
              ))}
            </div>
          )}
          <Field id={id("name")} label="Nome do patrocinador *" error={errors.name}>
            <Input
              id={id("name")}
              value={form.name}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id("name")}-error` : undefined}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <SponsorImageField
            label="Logo (opcional)"
            shape="square"
            value={form.logo}
            onChange={(v) => set("logo", v)}
            error={errors.logo}
            testId="sponsor-logo"
          />
          <Field id={id("contactName")} label="Nome do contato" error={errors.contactName}>
            <Input id={id("contactName")} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field id={id("contactEmail")} label="E-mail do contato" error={errors.contactEmail}>
            <Input
              id={id("contactEmail")}
              type="email"
              inputMode="email"
              value={form.contactEmail}
              aria-invalid={errors.contactEmail ? true : undefined}
              aria-describedby={errors.contactEmail ? `${id("contactEmail")}-error` : undefined}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
          </Field>
          <Field id={id("contactPhone")} label="Telefone do contato" error={errors.contactPhone}>
            <Input id={id("contactPhone")} type="tel" inputMode="tel" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
          </Field>
          <Field id={id("document")} label="Documento (CNPJ ou CPF)" error={errors.document} hint="Opcional. Fica só com você.">
            <Input id={id("document")} value={form.document} onChange={(e) => set("document", e.target.value)} />
          </Field>
          <Field
            id={id("notes")}
            label="Observações (privadas do grupo)"
            error={errors.notes}
            hint={`${String(form.notes.length)}/${String(SPONSOR_LIMITS.notesMax)} caracteres. Só o seu grupo vê.`}
          >
            <Textarea
              id={id("notes")}
              rows={4}
              value={form.notes}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={errors.notes ? `${id("notes")}-error` : undefined}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <SheetFooter className="sticky bottom-0 -mx-4 flex-row justify-end gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-sm:[&>button]:flex-1">
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
