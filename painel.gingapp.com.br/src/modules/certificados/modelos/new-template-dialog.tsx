import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/rodas/native-select";
import { templatesErrorMessage, useCreateTemplate, usePresets } from "./api";
import { blankLayout, validateName } from "./layout-utils";
import { LayoutThumb } from "./template-thumb";
import { LIMITS, PURPOSES, type CertificatePurpose, type CertificateTemplate } from "./types";

const BLANK = "__blank__";

/** "Novo modelo": em branco ou a partir de um modelo pronto (cópia editável criada no servidor com `presetKey`). */
export function NewTemplateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (template: CertificateTemplate) => void;
}) {
  const presets = usePresets(open);
  const create = useCreateTemplate();
  const [start, setStart] = useState<string>(BLANK);
  const [name, setName] = useState("Novo modelo");
  const [nameTouched, setNameTouched] = useState(false);
  const [purpose, setPurpose] = useState<CertificatePurpose>("OUTRO");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStart(BLANK);
    setName("Novo modelo");
    setNameTouched(false);
    setPurpose("OUTRO");
    setError(null);
  }, [open]);

  function choose(key: string) {
    setStart(key);
    const preset = presets.data?.find((p) => p.key === key);
    if (preset) {
      setPurpose(preset.purpose);
      if (!nameTouched) setName(preset.name);
    } else {
      setPurpose("OUTRO");
      if (!nameTouched) setName("Novo modelo");
    }
  }

  async function submit() {
    const problem = validateName(name);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const created = await create.mutateAsync(
        start === BLANK
          ? { name: name.trim(), purpose, layout: blankLayout() }
          : { name: name.trim(), purpose, presetKey: start },
      );
      onOpenChange(false);
      onCreated(created);
    } catch (e) {
      setError(templatesErrorMessage(e, "Não foi possível criar o modelo."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Novo modelo de certificado</DialogTitle>
          <DialogDescription>Comece de um modelo pronto (uma cópia que você pode editar) ou de uma folha em branco.</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 content-start gap-4 overflow-y-auto px-1 -mx-1">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-1">
              <Label htmlFor="new-template-name">Nome do modelo</Label>
              <Input
                id="new-template-name"
                value={name}
                maxLength={LIMITS.nameMax}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameTouched(true);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-template-purpose">Usado em</Label>
              <NativeSelect
                id="new-template-purpose"
                className="h-11 md:h-9"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as CertificatePurpose)}
              >
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Começar de</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Começar de">
              <StartOption
                selected={start === BLANK}
                label="Em branco"
                hint="Só o QR Code e a linha de verificação"
                onSelect={() => choose(BLANK)}
              >
                <LayoutThumb layout={blankLayout()} />
              </StartOption>
              {presets.data?.map((preset) => (
                <StartOption
                  key={preset.key}
                  selected={start === preset.key}
                  label={preset.name}
                  hint="Modelo pronto"
                  onSelect={() => choose(preset.key)}
                >
                  <LayoutThumb layout={preset.layout} />
                </StartOption>
              ))}
            </div>
            {presets.isLoading && <p className="text-xs text-muted-foreground">Carregando modelos prontos…</p>}
            {presets.error && (
              <p role="status" className="text-xs text-muted-foreground">
                Não foi possível carregar os modelos prontos agora; você ainda pode começar em branco.
              </p>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="border-t pt-4 max-sm:flex-row max-sm:gap-2 max-sm:[&>button]:flex-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={create.isPending}>
            {create.isPending ? "Criando…" : "Criar modelo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartOption({
  selected,
  label,
  hint,
  onSelect,
  children,
}: {
  selected: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        selected ? "border-primary bg-secondary/60" : "hover:bg-muted/50",
      )}
    >
      <input type="radio" name="template-start" className="sr-only" checked={selected} onChange={onSelect} aria-label={label} />
      {children}
      <span className="text-sm font-medium leading-tight">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}
