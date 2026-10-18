import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Loader2, Paperclip, RefreshCw, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FILE_ACCEPT,
  fileButtonLabel,
  formatBytes,
  maskInput,
  splitLinks,
  uploadErrorMessage,
  uploadFormFile,
  validateProofFile,
  type AnswerValue,
  type FileAnswer,
  type FormFieldDef,
} from "@/lib/inscricao";

/**
 * Texto simples seguro: preserva quebras de linha e transforma URLs http(s) em links
 * (`rel="noopener noreferrer nofollow"`). NUNCA interpreta HTML (nada de dangerouslySetInnerHTML).
 */
export function FormattedText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("whitespace-pre-line break-words [overflow-wrap:anywhere]", className)}>
      {splitLinks(text).map((part, index) =>
        part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-primary underline underline-offset-2"
          >
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

const controlClass = "h-11 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive";

const AUTOCOMPLETE: Record<string, string> = {
  name: "name",
  nickname: "nickname",
  birthDate: "bday",
  phone: "tel",
  email: "email",
};

interface FileFieldProps {
  slug: string;
  field: FormFieldDef;
  value: FileAnswer | undefined;
  invalid: boolean;
  describedBy: string | undefined;
  inputId: string;
  onChange: (value: FileAnswer | undefined) => void;
  onBusyChange: (busy: boolean) => void;
}

/** Upload de comprovante/documento: envia ao escolher, mostra miniatura/nome, permite trocar, remover e tentar de novo. */
function FileField({ slug, field, value, invalid, describedBy, inputId, onChange, onBusyChange }: FileFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState("");
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewRef.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  function setPreviewFor(file: File | null) {
    if (previewRef.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    if (file && file.type.startsWith("image/") && typeof URL.createObjectURL === "function") {
      previewRef.current = URL.createObjectURL(file);
    }
    setPreview(previewRef.current);
  }

  async function upload(file: File) {
    setLocalError("");
    setRetryFile(null);
    setUploading(true);
    onBusyChange(true);
    try {
      const sent = await uploadFormFile(slug, field.key, file);
      setPreviewFor(file);
      onChange({
        fileToken: sent.fileToken,
        originalName: sent.originalName || file.name,
        mimeType: sent.mimeType || file.type,
        sizeBytes: sent.sizeBytes || file.size,
      });
    } catch (error) {
      setLocalError(uploadErrorMessage(error));
      setRetryFile(file);
    } finally {
      setUploading(false);
      onBusyChange(false);
    }
  }

  function pick(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = ""; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    const problem = validateProofFile(file);
    if (problem) {
      setLocalError(problem);
      setRetryFile(null);
      return;
    }
    void upload(file);
  }

  function remove() {
    setPreviewFor(null);
    setLocalError("");
    setRetryFile(null);
    onChange(undefined);
  }

  const buttonLabel = fileButtonLabel(field);
  const isImage = value?.mimeType.startsWith("image/") ?? false;

  return (
    <div className="space-y-2" data-testid={`arquivo-${field.key}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        aria-label={buttonLabel}
        tabIndex={-1}
        disabled={uploading}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {value ? (
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {preview && isImage ? (
              <img src={preview} alt="Miniatura do arquivo enviado" className="size-full object-cover" />
            ) : (
              <FileText className="size-6 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={value.originalName}>
              {value.originalName}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(value.sizeBytes)} · enviado</p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
            <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={uploading} onClick={() => inputRef.current?.click()}>
              Trocar
            </Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 text-destructive" disabled={uploading} onClick={remove} aria-label="Remover arquivo">
              <Trash2 /> Remover
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={cn(
            "h-14 w-full whitespace-normal border-2 border-dashed border-primary/50 text-base font-semibold text-primary",
            invalid && "border-destructive text-destructive",
          )}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
          {uploading ? "Enviando arquivo…" : buttonLabel}
        </Button>
      )}
      {uploading && value && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Enviando arquivo…
        </p>
      )}
      {localError && (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-sm text-destructive">{localError}</p>
          {retryFile && (
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void upload(retryFile)}>
              <RefreshCw /> Tentar de novo
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Foto (JPG, PNG, WEBP) ou PDF, até 5 MB.</p>
    </div>
  );
}

interface FieldBlockProps {
  slug: string;
  field: FormFieldDef;
  value: AnswerValue | undefined;
  error: string | undefined;
  onChange: (key: string, value: AnswerValue | undefined) => void;
  onBusyChange: (key: string, busy: boolean) => void;
}

const rowClass =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary";
const nativeCheck = "size-5 shrink-0 accent-[var(--primary)]";

/** Um campo do formulário (rótulo, ajuda, marca de obrigatório, controle por tipo e erro). */
export function FieldBlock({ slug, field, value, error, onChange, onBusyChange }: FieldBlockProps) {
  const id = `campo-${field.key}`;
  const helpId = field.helpText ? `${id}-ajuda` : undefined;
  const errorId = error ? `${id}-erro` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = !!error;
  const text = typeof value === "string" ? value : "";
  const set = (next: AnswerValue | undefined) => onChange(field.key, next);

  if (field.type === "INFO") {
    return (
      <div data-field-key={field.key} className="rounded-lg border border-border bg-secondary/60 p-3 text-sm">
        {field.label && <p className="font-semibold">{field.label}</p>}
        {field.helpText && <FormattedText text={field.helpText} className="mt-1 text-muted-foreground" />}
      </div>
    );
  }

  const requiredMark = field.required ? (
    <>
      <span aria-hidden className="ml-0.5 text-destructive">
        *
      </span>
      <span className="sr-only"> (obrigatório)</span>
    </>
  ) : null;

  const help = field.helpText ? <FormattedText text={field.helpText} className="text-xs text-muted-foreground" /> : null;
  const errorNode = error ? (
    <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
      {error}
    </p>
  ) : null;
  const wrap = (children: ReactNode, asGroup = false) =>
    asGroup ? (
      <fieldset data-field-key={field.key} className="min-w-0 space-y-2 border-0 p-0" aria-describedby={describedBy}>
        <legend className="mb-1 text-sm font-semibold">
          {field.label}
          {requiredMark}
        </legend>
        {help && <div id={helpId}>{help}</div>}
        {children}
        {errorNode}
      </fieldset>
    ) : (
      <div data-field-key={field.key} className="min-w-0 space-y-1.5">
        {children}
        {errorNode}
      </div>
    );
  const labelNode = (
    <>
      <label htmlFor={id} className="block text-sm font-semibold">
        {field.label}
        {requiredMark}
      </label>
      {help && <div id={helpId}>{help}</div>}
    </>
  );

  switch (field.type) {
    case "LONG_TEXT":
      return wrap(
        <>
          {labelNode}
          <Textarea
            id={id}
            rows={4}
            value={text}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-required={field.required}
            className="min-h-24 aria-[invalid=true]:border-destructive"
            onChange={(e) => set(e.target.value)}
          />
        </>,
      );
    case "SELECT":
      return wrap(
        <>
          {labelNode}
          <select
            id={id}
            value={text}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-required={field.required}
            className={cn(
              "flex h-11 w-full rounded-md border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive md:text-sm",
            )}
            onChange={(e) => set(e.target.value)}
          >
            <option value="">Selecione…</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </>,
      );
    case "SINGLE_CHOICE":
      return wrap(
        <div role="radiogroup" aria-label={field.label} className="space-y-2">
          {(field.options ?? []).map((option, index) => (
            <label key={option} className={rowClass}>
              <input
                type="radio"
                name={id}
                id={index === 0 ? id : undefined}
                value={option}
                checked={text === option}
                className={nativeCheck}
                onChange={() => set(option)}
              />
              <span className="min-w-0 break-words">{option}</span>
            </label>
          ))}
        </div>,
        true,
      );
    case "MULTI_CHOICE": {
      const selected = Array.isArray(value) ? value : [];
      return wrap(
        <div className="space-y-2">
          {(field.options ?? []).map((option, index) => (
            <label key={option} className={rowClass}>
              <input
                type="checkbox"
                id={index === 0 ? id : undefined}
                value={option}
                checked={selected.includes(option)}
                className={nativeCheck}
                onChange={(e) => set(e.target.checked ? [...selected, option] : selected.filter((item) => item !== option))}
              />
              <span className="min-w-0 break-words">{option}</span>
            </label>
          ))}
        </div>,
        true,
      );
    }
    case "CONSENT":
      return wrap(
        <>
          <label className={cn(rowClass, "items-start py-3", invalid && "border-destructive")}>
            <input
              type="checkbox"
              id={id}
              checked={value === true}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              aria-required={field.required}
              className={cn(nativeCheck, "mt-0.5")}
              onChange={(e) => set(e.target.checked)}
            />
            <span className="min-w-0 break-words font-medium">
              {field.label}
              {requiredMark}
            </span>
          </label>
          {help && <div id={helpId}>{help}</div>}
        </>,
      );
    case "FILE":
      return wrap(
        <>
          <p className="text-sm font-semibold">
            {field.label}
            {requiredMark}
          </p>
          {help && <div id={helpId}>{help}</div>}
          <FileField
            slug={slug}
            field={field}
            inputId={id}
            value={value && typeof value === "object" && !Array.isArray(value) ? value : undefined}
            invalid={invalid}
            describedBy={describedBy}
            onChange={set}
            onBusyChange={(busy) => onBusyChange(field.key, busy)}
          />
        </>,
      );
    default: {
      // SHORT_TEXT, NUMBER, EMAIL, PHONE, CPF, DATE
      const kind =
        field.type === "EMAIL"
          ? { type: "email", inputMode: "email" as const }
          : field.type === "PHONE"
            ? { type: "tel", inputMode: "tel" as const }
            : field.type === "NUMBER"
              ? { type: "number", inputMode: "decimal" as const }
              : field.type === "CPF"
                ? { type: "text", inputMode: "numeric" as const }
                : field.type === "DATE"
                  ? { type: "date", inputMode: undefined }
                  : { type: "text", inputMode: undefined };
      const today = new Date().toISOString().slice(0, 10);
      return wrap(
        <>
          {labelNode}
          <Input
            id={id}
            type={kind.type}
            {...(kind.inputMode ? { inputMode: kind.inputMode } : {})}
            {...(field.type === "NUMBER" ? { step: "any" } : {})}
            {...(field.type === "DATE" ? { min: "1900-01-01", ...(field.mapsTo === "birthDate" ? { max: today } : {}) } : {})}
            {...(field.type === "EMAIL" ? { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } : {})}
            {...(field.type === "CPF" ? { placeholder: "000.000.000-00", autoComplete: "off" } : {})}
            {...(field.type === "PHONE" ? { placeholder: "(00) 00000-0000" } : {})}
            {...(field.mapsTo && AUTOCOMPLETE[field.mapsTo] ? { autoComplete: AUTOCOMPLETE[field.mapsTo] as string } : {})}
            value={text}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-required={field.required}
            className={cn(controlClass, "min-w-0")}
            onChange={(e) => set(maskInput(field.type, e.target.value))}
          />
        </>,
      );
    }
  }
}
