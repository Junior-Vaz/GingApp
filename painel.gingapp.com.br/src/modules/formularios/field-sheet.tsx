import { ArrowDown, ArrowUp, CopyPlus, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  allFields,
  conditionSources,
  findField,
  setValidation,
  type BField,
  type Draft,
} from "./builder";
import { SelectField, TextAreaField, TextField, ToggleRow } from "./form-controls";
import { FIELD_TYPE_INFO, LIMITS, MAPS_TO_OPTIONS, isChoiceType, type MapsTo } from "./types";

interface FieldSheetProps {
  draft: Draft;
  /** Chave do campo aberto (`null` = fechado). */
  fieldKey: string | null;
  readOnly: boolean;
  /** Mensagens de erro (cliente + servidor) deste campo. */
  errors: string[];
  onChange: (key: string, patch: Partial<Omit<BField, "key">>) => void;
  onMoveToSection: (key: string, cid: string) => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
  onClose: () => void;
}

/** Texto para o número digitado: "" = sem valor. */
const numberOrUndefined = (text: string): number | undefined =>
  text.trim() === "" ? undefined : Number(text);

/**
 * Edição de UM campo (painel lateral no computador, folha de baixo no celular). As mudanças valem na hora no rascunho
 * do editor; o botão "Concluir" só fecha. A `key` do campo é estável e não aparece como editável.
 */
export function FieldSheet({
  draft,
  fieldKey,
  readOnly,
  errors,
  onChange,
  onMoveToSection,
  onDuplicate,
  onRemove,
  onClose,
}: FieldSheetProps) {
  const isMobile = useIsMobile();
  const found = fieldKey ? findField(draft, fieldKey) : null;
  const field = found?.field ?? null;

  return (
    <Sheet open={field !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "max-h-[92dvh] overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "w-full overflow-y-auto sm:max-w-md"
        }
        data-testid="field-sheet"
      >
        {field && found && (
          <FieldEditor
            draft={draft}
            field={field}
            sectionCid={found.section.cid}
            readOnly={readOnly}
            errors={errors}
            onChange={(patch) => onChange(field.key, patch)}
            onMoveToSection={(cid) => onMoveToSection(field.key, cid)}
            onDuplicate={() => onDuplicate(field.key)}
            onRemove={() => onRemove(field.key)}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function FieldEditor({
  draft,
  field,
  sectionCid,
  readOnly,
  errors,
  onChange,
  onMoveToSection,
  onDuplicate,
  onRemove,
  onClose,
}: {
  draft: Draft;
  field: BField;
  sectionCid: string;
  readOnly: boolean;
  errors: string[];
  onChange: (patch: Partial<Omit<BField, "key">>) => void;
  onMoveToSection: (cid: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const info = FIELD_TYPE_INFO[field.type];
  const isInfo = field.type === "INFO";
  const choice = isChoiceType(field.type);
  const options = field.options ?? [];
  const sources = conditionSources(draft, field.key);
  const source = field.showIf ? sources.find((s) => s.key === field.showIf?.fieldKey) : undefined;
  const usedMaps = new Map<MapsTo, string>();
  for (const other of allFields(draft))
    if (other.mapsTo && other.key !== field.key) usedMaps.set(other.mapsTo, other.label);
  const canMap = !["INFO", "FILE", "CONSENT", "LONG_TEXT", "MULTI_CHOICE"].includes(field.type);
  const atFieldLimit = allFields(draft).length >= LIMITS.fields;

  const setOption = (index: number, value: string) =>
    onChange({ options: options.map((o, i) => (i === index ? value : o)) });
  const moveOption = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange({ options: next });
  };
  const validationNumber = (name: string): string => {
    const v = field.validation?.[name];
    return typeof v === "number" ? String(v) : "";
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <info.icon className="size-5 text-muted-foreground" aria-hidden /> Editar campo
        </SheetTitle>
        <SheetDescription>
          {info.label}. As mudanças valem na hora; lembre de salvar o formulário.
        </SheetDescription>
      </SheetHeader>

      {errors.length > 0 && (
        <ul
          role="alert"
          className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <fieldset
        disabled={readOnly}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 border-0 p-0"
      >
        <TextField
          label={isInfo ? "Título do aviso" : "Rótulo (a pergunta)"}
          value={field.label}
          maxLength={200}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <TextAreaField
          label={isInfo ? "Texto do aviso" : "Texto de ajuda (opcional)"}
          value={field.helpText}
          maxLength={1000}
          rows={isInfo ? 5 : 2}
          onChange={(e) => onChange({ helpText: e.target.value })}
        />

        {!isInfo && (
          <ToggleRow
            label="Resposta obrigatória"
            checked={field.required}
            disabled={readOnly}
            onCheckedChange={(required) => onChange({ required })}
          />
        )}

        {choice && (
          <div className="grid gap-2" role="group" aria-label="Opções de resposta">
            <p className="text-sm font-medium">
              Opções{" "}
              <span className="font-normal text-muted-foreground">
                ({options.length} de {LIMITS.options})
              </span>
            </p>
            <ul className="grid gap-2">
              {options.map((option, index) => (
                <li key={index} className="flex items-center gap-1">
                  <Input
                    value={option}
                    maxLength={120}
                    aria-label={`Opção ${String(index + 1)}`}
                    onChange={(e) => setOption(index, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Subir opção ${String(index + 1)}`}
                    disabled={index === 0}
                    onClick={() => moveOption(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Descer opção ${String(index + 1)}`}
                    disabled={index === options.length - 1}
                    onClick={() => moveOption(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover opção ${String(index + 1)}`}
                    onClick={() => onChange({ options: options.filter((_, i) => i !== index) })}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={options.length >= LIMITS.options}
              onClick={() =>
                onChange({ options: [...options, `Opção ${String(options.length + 1)}`] })
              }
            >
              <Plus /> Adicionar opção
            </Button>
          </div>
        )}

        {(field.type === "SHORT_TEXT" || field.type === "LONG_TEXT") && (
          <TextField
            label="Tamanho máximo (caracteres)"
            type="number"
            inputMode="numeric"
            min={1}
            value={validationNumber("maxLength")}
            hint="Deixe vazio para o padrão do servidor."
            onChange={(e) =>
              onChange({
                validation: setValidation(field, { maxLength: numberOrUndefined(e.target.value) }),
              })
            }
          />
        )}
        {field.type === "NUMBER" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Valor mínimo"
              type="number"
              inputMode="decimal"
              value={validationNumber("min")}
              onChange={(e) =>
                onChange({
                  validation: setValidation(field, { min: numberOrUndefined(e.target.value) }),
                })
              }
            />
            <TextField
              label="Valor máximo"
              type="number"
              inputMode="decimal"
              value={validationNumber("max")}
              onChange={(e) =>
                onChange({
                  validation: setValidation(field, { max: numberOrUndefined(e.target.value) }),
                })
              }
            />
          </div>
        )}

        {canMap && (
          <SelectField
            label="Este campo é"
            hint="Liga a resposta à ficha da pessoa (nome, CPF, graduação…) quando a inscrição for aprovada."
            value={field.mapsTo ?? ""}
            onChange={(e) => onChange({ mapsTo: (e.target.value || null) as MapsTo | null })}
          >
            <option value="">Nenhum</option>
            {MAPS_TO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={usedMaps.has(opt.value)}>
                {opt.label}
                {usedMaps.has(opt.value) ? " (já usado)" : ""}
              </option>
            ))}
          </SelectField>
        )}

        {!isInfo && (
          <div
            className="grid gap-3 rounded-md border p-3"
            role="group"
            aria-label="Condição para mostrar o campo"
          >
            <SelectField
              label="Mostrar este campo"
              value={field.showIf?.fieldKey ?? ""}
              onChange={(e) =>
                onChange({
                  showIf: e.target.value ? { fieldKey: e.target.value, equals: "" } : null,
                })
              }
            >
              <option value="">Sempre</option>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  Só se “{s.label || FIELD_TYPE_INFO[s.type].label}” for…
                </option>
              ))}
            </SelectField>
            {field.showIf &&
              (source?.options && source.options.length > 0 ? (
                <SelectField
                  label="Valor que libera o campo"
                  value={field.showIf.equals}
                  onChange={(e) =>
                    field.showIf &&
                    onChange({ showIf: { ...field.showIf, equals: e.target.value } })
                  }
                >
                  <option value="">Escolha…</option>
                  {source.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <TextField
                  label="Valor que libera o campo"
                  value={field.showIf.equals}
                  onChange={(e) =>
                    field.showIf &&
                    onChange({ showIf: { ...field.showIf, equals: e.target.value } })
                  }
                />
              ))}
            {sources.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Só é possível usar campos que vêm antes deste.
              </p>
            )}
          </div>
        )}

        {draft.sections.length > 1 && (
          <SelectField
            label="Seção"
            value={sectionCid}
            onChange={(e) => onMoveToSection(e.target.value)}
          >
            {draft.sections.map((s, i) => (
              <option key={s.cid} value={s.cid}>
                {s.title || `Seção ${String(i + 1)}`}
              </option>
            ))}
          </SelectField>
        )}
      </fieldset>

      <SheetFooter className="gap-2 sm:flex-col sm:space-x-0">
        <Button type="button" onClick={onClose}>
          Concluir
        </Button>
        {!readOnly && (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={atFieldLimit} onClick={onDuplicate}>
              <CopyPlus /> Duplicar
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 /> Remover
            </Button>
          </div>
        )}
      </SheetFooter>
    </div>
  );
}
