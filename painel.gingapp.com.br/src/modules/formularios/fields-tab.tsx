import { useState } from "react";
import { ArrowDown, ArrowUp, CopyPlus, GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  addField,
  addSection,
  allFields,
  canMoveField,
  dependentsOf,
  duplicateField,
  fieldCount,
  fileFieldCount,
  mapsToLabel,
  moveField,
  moveFieldToSection,
  moveSection,
  removeField,
  removeSection,
  updateField,
  updateSection,
  type BField,
  type BSection,
  type Draft,
} from "./builder";
import { FieldSheet } from "./field-sheet";
import { TextField } from "./form-controls";
import { FIELD_TYPES, FIELD_TYPE_INFO, LIMITS, type FieldType } from "./types";

interface FieldsTabProps {
  draft: Draft;
  readOnly: boolean;
  onChange: (next: Draft) => void;
  /** Mensagens por chave de campo (validação do cliente + erros do servidor). */
  errorsByField: Record<string, string[]>;
  /** Mensagens gerais da aba (seção sem título, limite excedido…). */
  generalErrors: string[];
}

/** Aba "Campos": seções com seus campos, adicionar/mover/duplicar/remover e edição num painel lateral. */
export function FieldsTab({
  draft,
  readOnly,
  onChange,
  errorsByField,
  generalErrors,
}: FieldsTabProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [removingSection, setRemovingSection] = useState<string | null>(null);

  const total = fieldCount(draft);
  const removingField = removingKey
    ? allFields(draft).find((f) => f.key === removingKey)
    : undefined;
  const removingDependents = removingKey ? dependentsOf(draft, removingKey) : [];
  const sectionToRemove = draft.sections.find((s) => s.cid === removingSection);

  function pick(type: FieldType) {
    if (!pickerFor) return;
    const result = addField(draft, pickerFor, type);
    onChange(result.draft);
    setPickerFor(null);
    setEditingKey(result.key); // já abre para ajustar o rótulo
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="text-sm text-muted-foreground" data-testid="builder-counters">
        {total} de {LIMITS.fields} campos · {draft.sections.length} de {LIMITS.sections} seções ·{" "}
        {fileFieldCount(draft)} de {LIMITS.files} envios de arquivo
      </p>

      {generalErrors.length > 0 && (
        <ul
          role="alert"
          className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {generalErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {draft.sections.map((section, sectionIndex) => (
        <SectionCard
          key={section.cid}
          section={section}
          index={sectionIndex}
          draft={draft}
          readOnly={readOnly}
          errorsByField={errorsByField}
          onTitle={(title) => onChange(updateSection(draft, section.cid, { title }))}
          onDescription={(description) =>
            onChange(updateSection(draft, section.cid, { description }))
          }
          onMoveSection={(direction) => onChange(moveSection(draft, section.cid, direction))}
          onRemoveSection={() =>
            section.fields.length === 0
              ? onChange(removeSection(draft, section.cid))
              : setRemovingSection(section.cid)
          }
          onAddField={() => setPickerFor(section.cid)}
          onEdit={setEditingKey}
          onMoveField={(key, direction) => onChange(moveField(draft, key, direction))}
          onDuplicate={(key) => {
            const result = duplicateField(draft, key);
            if (result) onChange(result.draft);
          }}
          onRemoveField={setRemovingKey}
        />
      ))}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          disabled={draft.sections.length >= LIMITS.sections}
          onClick={() => onChange(addSection(draft))}
        >
          <Plus /> Adicionar seção
        </Button>
      )}

      <FieldSheet
        draft={draft}
        fieldKey={editingKey}
        readOnly={readOnly}
        errors={editingKey ? (errorsByField[editingKey] ?? []) : []}
        onChange={(key, patch) => onChange(updateField(draft, key, patch))}
        onMoveToSection={(key, cid) => onChange(moveFieldToSection(draft, key, cid))}
        onDuplicate={(key) => {
          const result = duplicateField(draft, key);
          if (result) {
            onChange(result.draft);
            setEditingKey(result.key);
          }
        }}
        onRemove={(key) => setRemovingKey(key)}
        onClose={() => setEditingKey(null)}
      />

      <Dialog open={pickerFor !== null} onOpenChange={(open) => !open && setPickerFor(null)}>
        <DialogContent className="sm:max-w-xl" data-testid="field-type-picker">
          <DialogHeader>
            <DialogTitle>Adicionar campo</DialogTitle>
            <DialogDescription>Escolha o tipo de resposta que você quer receber.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FIELD_TYPES.map((info) => (
              <li key={info.type}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal py-2 text-left"
                  onClick={() => pick(info.type)}
                >
                  <info.icon aria-hidden /> {info.label}
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removingKey !== null}
        onOpenChange={(open) => !open && setRemovingKey(null)}
        title="Remover campo?"
        description={
          <>
            {removingField
              ? `“${removingField.label || FIELD_TYPE_INFO[removingField.type].label}” sai do formulário. `
              : ""}
            As respostas já recebidas para este campo são preservadas e continuam aparecendo nas
            inscrições.
            {removingDependents.length > 0 &&
              ` ${String(removingDependents.length)} campo(s) que dependiam dele passam a aparecer sempre.`}
          </>
        }
        confirmLabel="Remover"
        onConfirm={() => {
          if (!removingKey) return;
          onChange(removeField(draft, removingKey));
          if (editingKey === removingKey) setEditingKey(null);
        }}
      />
      <ConfirmDialog
        open={removingSection !== null}
        onOpenChange={(open) => !open && setRemovingSection(null)}
        title="Remover seção?"
        description={
          sectionToRemove
            ? `“${sectionToRemove.title}” e os ${String(sectionToRemove.fields.length)} campo(s) dela saem do formulário. As respostas já recebidas são preservadas.`
            : undefined
        }
        confirmLabel="Remover seção"
        onConfirm={() => {
          if (removingSection) onChange(removeSection(draft, removingSection));
        }}
      />
    </div>
  );
}

interface SectionCardProps {
  section: BSection;
  index: number;
  draft: Draft;
  readOnly: boolean;
  errorsByField: Record<string, string[]>;
  onTitle: (title: string) => void;
  onDescription: (description: string) => void;
  onMoveSection: (direction: -1 | 1) => void;
  onRemoveSection: () => void;
  onAddField: () => void;
  onEdit: (key: string) => void;
  onMoveField: (key: string, direction: -1 | 1) => void;
  onDuplicate: (key: string) => void;
  onRemoveField: (key: string) => void;
}

function SectionCard({
  section,
  index,
  draft,
  readOnly,
  errorsByField,
  onTitle,
  onDescription,
  onMoveSection,
  onRemoveSection,
  onAddField,
  onEdit,
  onMoveField,
  onDuplicate,
  onRemoveField,
}: SectionCardProps) {
  const atFieldLimit = fieldCount(draft) >= LIMITS.fields;
  return (
    <section
      aria-label={`Seção ${String(index + 1)}: ${section.title}`}
      className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-card p-3 sm:p-4"
      data-testid="builder-section"
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <TextField
              label={`Título da seção ${String(index + 1)}`}
              value={section.title}
              maxLength={120}
              disabled={readOnly}
              onChange={(e) => onTitle(e.target.value)}
            />
          </div>
          {!readOnly && (
            <div className="flex shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Subir seção ${String(index + 1)}`}
                disabled={index === 0}
                onClick={() => onMoveSection(-1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Descer seção ${String(index + 1)}`}
                disabled={index === draft.sections.length - 1}
                onClick={() => onMoveSection(1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover seção ${String(index + 1)}`}
                disabled={draft.sections.length <= 1}
                onClick={onRemoveSection}
              >
                <Trash2 />
              </Button>
            </div>
          )}
        </div>
        <TextField
          label="Descrição da seção (opcional)"
          value={section.description}
          maxLength={500}
          disabled={readOnly}
          onChange={(e) => onDescription(e.target.value)}
        />
      </div>

      {section.fields.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhum campo nesta seção ainda.
        </p>
      ) : (
        <ol className="grid gap-2">
          {section.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              draft={draft}
              readOnly={readOnly}
              errors={errorsByField[field.key] ?? []}
              onEdit={() => onEdit(field.key)}
              onMove={(direction) => onMoveField(field.key, direction)}
              onDuplicate={() => onDuplicate(field.key)}
              onRemove={() => onRemoveField(field.key)}
              atFieldLimit={atFieldLimit}
            />
          ))}
        </ol>
      )}

      {!readOnly && (
        <Button
          type="button"
          variant="secondary"
          className="justify-self-start"
          disabled={atFieldLimit}
          onClick={onAddField}
        >
          <Plus /> Adicionar campo
        </Button>
      )}
    </section>
  );
}

function FieldRow({
  field,
  draft,
  readOnly,
  errors,
  atFieldLimit,
  onEdit,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: BField;
  draft: Draft;
  readOnly: boolean;
  errors: string[];
  atFieldLimit: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const info = FIELD_TYPE_INFO[field.type];
  const name = field.label.trim() || info.label;
  const source = field.showIf
    ? allFields(draft).find((f) => f.key === field.showIf?.fieldKey)
    : undefined;
  return (
    <li
      data-testid="builder-field"
      data-field-key={field.key}
      className={cn(
        "rounded-lg border bg-background p-2.5",
        errors.length > 0 && "border-destructive/60",
      )}
    >
      <div className="flex items-start gap-2">
        <info.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{name}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
            <span>{info.label}</span>
            {field.required && <Badge variant="secondary">Obrigatório</Badge>}
            {field.mapsTo && <Badge variant="outline">Ficha: {mapsToLabel(field.mapsTo)}</Badge>}
            {field.showIf && (
              <Badge variant="outline" className="gap-1">
                <GitBranch className="size-3" aria-hidden /> Só se “{source?.label ?? "?"}” ={" "}
                {field.showIf.equals || "…"}
              </Badge>
            )}
          </div>
        </div>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-1.5 grid gap-0.5 text-xs text-destructive">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-0.5">
        {!readOnly && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Subir ${name}`}
              disabled={!canMoveField(draft, field.key, -1)}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Descer ${name}`}
              disabled={!canMoveField(draft, field.key, 1)}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Duplicar ${name}`}
              disabled={atFieldLimit}
              onClick={onDuplicate}
            >
              <CopyPlus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover ${name}`}
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${readOnly ? "Ver" : "Editar"} ${name}`}
          onClick={onEdit}
        >
          <Pencil /> {readOnly ? "Ver" : "Editar"}
        </Button>
      </div>
    </li>
  );
}
