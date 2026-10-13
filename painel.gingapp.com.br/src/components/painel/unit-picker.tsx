import { useId, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useDebouncedValue } from "@/lib/list-params";
import { UNIT_SEARCH_LIMIT, useUnitById, useUnitSearch, type UnitOption } from "@/lib/unit-lookup";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/aulas/native-select";

export type { UnitOption };

export interface UnitPickerProps {
  /** Id da unidade escolhida (`null` = nenhuma / "todo o grupo"). Controlado: o pai guarda só o id. */
  value: number | null;
  /** Escolha/limpeza. Recebe o objeto da unidade (ou `null` ao limpar). */
  onChange: (unit: UnitOption | null) => void;
  /**
   * `form` (padrão): rótulos visíveis "Buscar unidade" + `label`, um acima do outro.
   * `filter`: compacto, em linha, para toolbars (rótulos só por `aria-label`; opção vazia = "Todas as unidades").
   */
  mode?: "form" | "filter";
  /** Só `form`: campo opcional. A opção vazia vira "Sem unidade" (default) em vez de "Selecione…". */
  optional?: boolean;
  /** Rótulo do select. Padrão: "Unidade" (form) / "Filtrar por unidade" (filter). */
  label?: string;
  /** Texto da opção vazia (ex.: "Todo o grupo"). Sobrescreve o padrão do modo. */
  emptyLabel?: string;
  /**
   * Objeto da unidade de `value` quando o registro já o traz: evita o GET /units/:id. Sem ele, a
   * unidade atual é resolvida por id se não estiver nos resultados.
   */
  initial?: UnitOption | null;
  disabled?: boolean;
  className?: string;
}

const optionLabel = (u: UnitOption) => `${u.name}${u.status === "INACTIVE" ? " (inativa)" : ""}`;

/**
 * Seletor de unidade com busca NO SERVIDOR (não carrega a lista inteira): o campo "Buscar unidade"
 * (debounce 300ms) consulta `GET /units?q=&limit=20` e o select lista os resultados.
 *
 * A unidade atual NUNCA some da lista, mesmo que a busca mude e ela deixe de casar: vem do objeto
 * escolhido pelo usuário, de `initial`, dos resultados ou — numa edição em que a unidade não está
 * nos 20 resultados — de `GET /units/:id`. Análogo ao `StudentPicker`.
 *
 *   <UnitPicker optional label="Público" emptyLabel="Todo o grupo" value={id} onChange={(u) => setId(u?.id ?? null)} />
 *   <UnitPicker mode="filter" value={id} onChange={(u) => lp.setFilter("unitId", u ? String(u.id) : "")} />
 */
export function UnitPicker({
  value,
  onChange,
  mode = "form",
  optional = false,
  label,
  emptyLabel,
  initial,
  disabled,
  className,
}: UnitPickerProps) {
  const uid = useId();
  const searchId = `${uid}-busca`;
  const selectId = `${uid}-unidade`;
  const hintId = `${uid}-hint`;
  const isFilter = mode === "filter";

  const [text, setText] = useState("");
  const [picked, setPicked] = useState<UnitOption | null>(null);
  const q = useDebouncedValue(text.trim(), 300);
  const search = useUnitSearch(q);

  const results = search.data?.items ?? [];
  const total = search.data?.total ?? 0;

  // Qual é a unidade de `value`? escolhida agora > objeto do registro > resultados da busca.
  const known: UnitOption | null =
    value === null
      ? null
      : picked?.id === value
        ? picked
        : initial?.id === value
          ? initial
          : (results.find((u) => u.id === value) ?? null);
  // Fora dos resultados (edição de unidade antiga): resolve por id, só quando a busca já assentou.
  const byId = useUnitById(value, known === null && !search.isPending);
  const current: UnitOption | null = known ?? (byId.data && byId.data.id === value ? byId.data : null);

  const options = current ? [current, ...results.filter((u) => u.id !== current.id)] : results;

  const selectLabel = label ?? (isFilter ? "Filtrar por unidade" : "Unidade");
  const emptyOption = emptyLabel ?? (isFilter ? "Todas as unidades" : optional ? "Sem unidade" : "Selecione…");

  const unresolved = value !== null && current === null;
  const searchError = search.error ? errorMessage(search.error, "Não foi possível carregar as unidades.") : null;
  const currentError =
    unresolved && byId.error ? errorMessage(byId.error, "Não foi possível carregar a unidade atual.") : null;
  const status = search.isLoading
    ? "Carregando unidades…"
    : !search.error && results.length === 0 && !current
      ? "Nenhuma unidade encontrada."
      : total > UNIT_SEARCH_LIMIT
        ? `Mostrando ${UNIT_SEARCH_LIMIT} de ${total} unidades. Digite para refinar a busca.`
        : null;

  function handleSelect(raw: string) {
    const next = raw === "" ? null : (options.find((u) => String(u.id) === raw) ?? null);
    setPicked(next);
    onChange(next);
  }

  const searchBox = (
    <div className={cn("relative", isFilter && "w-36")}>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-3.5 md:top-2.5 size-4 text-muted-foreground" />
      <Input
        id={searchId}
        type="search"
        className="pl-8"
        placeholder={isFilter ? "Buscar unidade…" : "Digite o nome da unidade…"}
        aria-label={isFilter ? "Buscar unidade" : undefined}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        // Dentro de um <form> o Enter dispararia o submit do formulário inteiro (gravava o registro
        // SEM unidade). A busca é por digitação (debounce), então o Enter não deve fazer nada aqui.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
    </div>
  );

  const select = (
    <NativeSelect
      id={selectId}
      aria-label={isFilter ? selectLabel : undefined}
      aria-describedby={hintId}
      aria-busy={search.isFetching}
      className={isFilter ? "w-44" : undefined}
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => handleSelect(e.target.value)}
    >
      <option value="">{emptyOption}</option>
      {unresolved && (
        <option value={String(value)}>{byId.isError ? `Unidade #${String(value)}` : "Carregando unidade…"}</option>
      )}
      {options.map((u) => (
        <option key={u.id} value={String(u.id)}>
          {optionLabel(u)}
        </option>
      ))}
    </NativeSelect>
  );

  const messages = (
    <>
      {status && (
        <p
          id={hintId}
          role="status"
          data-testid="unit-picker-status"
          className={cn("text-xs text-muted-foreground", isFilter && "sr-only")}
        >
          {status}
        </p>
      )}
      {(searchError || currentError) && (
        <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
          {currentError ?? searchError}
          {searchError && !currentError && (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void search.refetch()}>
              Tentar novamente
            </Button>
          )}
        </p>
      )}
    </>
  );

  if (isFilter) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {searchBox}
        {select}
        {messages}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={searchId} className="text-sm font-medium">Buscar unidade</label>
      {searchBox}
      <label htmlFor={selectId} className="text-sm font-medium">{selectLabel}</label>
      {select}
      {messages}
    </div>
  );
}
