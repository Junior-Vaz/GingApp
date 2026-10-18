import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/rodas/native-select";
import { useCreateForm, useEventOptions, useTemplates } from "./api";
import type { FormDefinition, Id, TemplateKey } from "./types";

interface NewFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Evento já escolhido (atalho em Eventos): o seletor some e o formulário nasce ligado a ele. */
  presetEvent?: { id: Id; title: string } | null;
  onCreated: (form: FormDefinition) => void;
}

/** "Novo formulário": título, evento (opcional) e MODELO (cartões). Cria como RASCUNHO já com os campos do modelo. */
export function NewFormDialog({
  open,
  onOpenChange,
  presetEvent = null,
  onCreated,
}: NewFormDialogProps) {
  const titleId = useId();
  const eventSelectId = useId();
  const templates = useTemplates(open);
  const events = useEventOptions(open && !presetEvent);
  const create = useCreateForm();
  const [title, setTitle] = useState("");
  const [eventKey, setEventKey] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("SIMPLES");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(presetEvent ? `Inscrições — ${presetEvent.title}` : "");
    setEventKey("");
    setTemplate("SIMPLES");
    setTouched(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reinicia só ao abrir
  }, [open]);

  const titleError =
    touched && title.trim().length < 2
      ? "Informe o título do formulário (mínimo 2 caracteres)."
      : null;

  function pickEvent(value: string) {
    setEventKey(value);
    const chosen = events.data?.find((e) => String(e.id) === value);
    if (chosen && !title.trim()) setTitle(`Inscrições — ${chosen.title}`);
  }

  function submit() {
    setTouched(true);
    if (title.trim().length < 2) return;
    const eventId: Id | undefined = presetEvent
      ? presetEvent.id
      : events.data?.find((e) => String(e.id) === eventKey)?.id;
    create.mutate(
      { title: title.trim(), template, ...(eventId !== undefined ? { eventId } : {}) },
      {
        onSuccess: (form) => {
          onOpenChange(false);
          onCreated(form);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl" data-testid="new-form-dialog">
        <DialogHeader>
          <DialogTitle>Novo formulário de inscrição</DialogTitle>
          <DialogDescription>
            Escolha um modelo para começar; você poderá mudar os campos depois. O formulário nasce
            como rascunho.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor={titleId}>Título</Label>
            <Input
              id={titleId}
              value={title}
              maxLength={120}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? `${titleId}-error` : undefined}
              placeholder="Ex.: 1º Campeonato de Capoeira"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            {titleError && (
              <p id={`${titleId}-error`} role="alert" className="text-xs text-destructive">
                {titleError}
              </p>
            )}
          </div>

          {presetEvent ? (
            <p className="text-sm text-muted-foreground">
              Ligado ao evento <strong className="text-foreground">{presetEvent.title}</strong>.
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={eventSelectId}>Evento (opcional)</Label>
              <NativeSelect
                id={eventSelectId}
                className="h-11 md:h-9"
                value={eventKey}
                onChange={(e) => pickEvent(e.target.value)}
              >
                <option value="">Sem evento (formulário avulso)</option>
                {(events.data ?? []).map((event) => (
                  <option key={String(event.id)} value={String(event.id)}>
                    {event.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Modelo</legend>
            <div
              role="radiogroup"
              aria-label="Modelo do formulário"
              className="grid gap-2 sm:grid-cols-2"
            >
              {templates.map((tpl) => {
                const selected = template === tpl.key;
                return (
                  <label
                    key={tpl.key}
                    className={cn(
                      "flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent/40",
                      selected && "border-primary bg-primary/5 ring-1 ring-primary",
                    )}
                  >
                    <input
                      type="radio"
                      name="form-template"
                      className="sr-only"
                      checked={selected}
                      onChange={() => setTemplate(tpl.key)}
                      aria-label={tpl.name}
                    />
                    <span className="text-sm font-semibold">{tpl.name}</span>
                    <span className="text-xs text-muted-foreground">{tpl.description}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Criar formulário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
