import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyError } from "@/lib/crud";
import { UPLOAD_ACCEPT, imageSrc, uploadImage, validateImageFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { clamp, isHexColor, normalizeHex, round2 } from "./layout-utils";

/** Campo numérico: aceita digitação livre (o valor só é aplicado quando é número) e limita à faixa. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Mostrado junto ao rótulo: "pt", "%". */
  unit?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const shown = String(round2(value));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
        {unit ? ` (${unit})` : ""}
      </Label>
      <Input
        id={id}
        className="pointer-coarse:h-11"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(shown);
        }}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
        }}
      />
    </div>
  );
}

/**
 * Cor '#RRGGBB': seletor do navegador + campo de código. `validate` pode recusar uma cor (ex.: QR claro demais):
 * a cor recusada não é aplicada e a mensagem aparece abaixo. `nullable` acrescenta a opção "sem cor".
 */
export function ColorField({
  label,
  value,
  onChange,
  nullable,
  nullLabel = "Sem cor",
  validate,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  nullable?: boolean;
  nullLabel?: string;
  validate?: (hex: string) => string | null;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value ?? "");
    setError(null);
  }, [value]);

  function commit(raw: string) {
    setText(raw);
    if (!isHexColor(raw)) {
      // Só reclama quando o código já parece completo (não atrapalha quem está digitando).
      setError(raw.trim().length >= 7 ? "Use o formato #RRGGBB, por exemplo #1F2937." : null);
      return;
    }
    const hex = normalizeHex(raw);
    const refused = validate?.(hex) ?? null;
    setError(refused);
    if (!refused) onChange(hex);
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (seletor de cor)`}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50 md:h-9"
          value={value && isHexColor(value) ? value.toLowerCase() : "#000000"}
          disabled={nullable && value === null}
          onChange={(event) => commit(event.target.value)}
        />
        <Input
          id={id}
          aria-label={`${label} (código hexadecimal)`}
          aria-invalid={error ? true : undefined}
          className="font-mono"
          maxLength={7}
          placeholder="#RRGGBB"
          value={text}
          disabled={nullable && value === null}
          onChange={(event) => commit(event.target.value)}
        />
      </div>
      {nullable && (
        <label className="flex min-h-11 items-center gap-2 text-xs md:min-h-0">
          <input
            type="checkbox"
            className="size-4"
            checked={value === null}
            onChange={(event) => onChange(event.target.checked ? null : "#000000")}
          />
          {nullLabel}
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Grupo de botões de escolha única (alinhamento, orientação…). */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium leading-none">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            className="pointer-coarse:h-11"
            variant={option.value === value ? "default" : "outline"}
            aria-pressed={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 border-t pt-3 first:border-t-0 first:pt-0", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Envio de imagem do desenho: SÓ pelo upload do painel (POST /uploads) — o desenho guarda a referência
 * `/api/uploads/<arquivo>`; sem campo de link externo (o backend recusa).
 */
export function ImagePicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (ref: string | null) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [value]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) return notifyError(new Error(invalid), invalid);
    setUploading(true);
    try {
      onChange(await uploadImage(file));
    } catch (error) {
      notifyError(error, "Não foi possível enviar a imagem. Tente novamente.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2" data-testid="image-picker">
      <p className="text-xs font-medium leading-none">{label}</p>
      <div className="flex items-start gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
          {value && !failed ? (
            <img src={imageSrc(value)} alt="Imagem escolhida" className="size-full object-cover" onError={() => setFailed(true)} />
          ) : (
            <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            aria-label={`${label}: escolher arquivo`}
            data-testid="image-file-input"
            tabIndex={-1}
            disabled={disabled || uploading}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            {uploading ? "Enviando…" : value ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" disabled={disabled || uploading} onClick={() => onChange(null)}>
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP até 5 MB.</p>
    </div>
  );
}
