import type { ComponentProps } from "react";
import { NativeSelect } from "@/modules/rodas/native-select";
import { useTemplates } from "./api";
import { TemplateThumb } from "./template-thumb";
import { PURPOSE_LABEL } from "./types";

type SelectProps = Omit<ComponentProps<"select">, "value" | "onChange" | "children">;

/**
 * Seletor do modelo ao EMITIR certificado. O valor "" é "Modelo padrão do grupo": o servidor escolhe o padrão do uso
 * (Graduação se houver graduação vinculada; senão Outro) ou, sem padrão, o clássico embutido — e `templateId` não é
 * enviado. Escolher um modelo envia o `templateId` dele. Mostra a miniatura do modelo que será usado.
 * As props extras (id, aria-*) vão para o <select>, para funcionar dentro de <FormControl>.
 */
export function TemplateSelect({
  value,
  onChange,
  ...selectProps
}: SelectProps & { value: string; onChange: (value: string) => void }) {
  const query = useTemplates();
  const templates = query.data ?? [];
  // Na emissão avulsa (sem graduação vinculada) o servidor usa o padrão do uso "Outro".
  const groupDefault = templates.find((t) => t.isDefault && t.purpose === "OUTRO");
  const chosen = value ? templates.find((t) => String(t.id) === value) : groupDefault;

  return (
    <div className="space-y-2">
      <NativeSelect
        className="h-11 md:h-9"
        {...selectProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Modelo padrão do grupo{groupDefault ? ` (${groupDefault.name})` : ""}</option>
        {templates.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.name} — {PURPOSE_LABEL[t.purpose]}
            {t.isDefault ? " (padrão)" : ""}
          </option>
        ))}
      </NativeSelect>
      {chosen ? (
        <div className="max-w-56" data-testid="issue-template-preview">
          <TemplateThumb id={chosen.id} orientation={chosen.orientation} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {query.isLoading ? "Carregando modelos…" : "Sem modelo padrão: o certificado usa o modelo clássico."}
        </p>
      )}
    </div>
  );
}
