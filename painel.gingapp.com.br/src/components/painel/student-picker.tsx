import { useId, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useDebouncedValue } from "@/lib/list-params";
import {
  STUDENT_SEARCH_LIMIT,
  useStudentById,
  useStudentSearch,
  type StudentOption,
} from "@/lib/student-lookup";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/modules/aulas/native-select";

export type { StudentOption };

export interface StudentPickerProps {
  /** Id do aluno escolhido (`null` = nenhum). Componente controlado: o pai guarda só o id. */
  value: number | null;
  /** Escolha/limpeza. Recebe o objeto do aluno (ou `null` ao limpar). */
  onChange: (student: StudentOption | null) => void;
  /**
   * `form` (padrão): rótulos visíveis "Buscar aluno" + `label`, um acima do outro.
   * `filter`: compacto, em linha, para toolbars (rótulos só por `aria-label`; opção vazia = "Todos os alunos").
   */
  mode?: "form" | "filter";
  /** Só `form`: campo opcional. A opção vazia vira "Sem aluno" (default) em vez de "Selecione…". */
  optional?: boolean;
  /** Rótulo do select. Padrão: "Aluno" (form) / "Filtrar por aluno" (filter). */
  label?: string;
  /** Texto da opção vazia (sobrescreve o padrão do modo). */
  emptyLabel?: string;
  /**
   * Objeto do aluno de `value` quando o registro já o traz (ex.: `certificate.student`): evita o
   * GET /students/:id. Sem ele, o aluno atual é resolvido por id se não estiver nos resultados.
   */
  initial?: StudentOption | null;
  disabled?: boolean;
  className?: string;
  /** Ids de alunos a esconder dos resultados (ex.: já matriculados). O aluno atual (`value`) nunca é removido. */
  excludeIds?: number[];
}

const optionLabel = (s: StudentOption) => `${s.name}${s.status === "INACTIVE" ? " (inativo)" : ""}`;

/**
 * Seletor de aluno com busca NO SERVIDOR (não carrega a lista inteira): o campo "Buscar aluno"
 * (debounce 300ms) consulta `GET /students?q=&limit=20` e o select lista os resultados.
 *
 * O aluno atual NUNCA some da lista, mesmo que a busca mude e ele deixe de casar: vem do objeto
 * escolhido pelo usuário, de `initial`, dos resultados ou — numa edição em que o aluno não está
 * nos 20 resultados — de `GET /students/:id`.
 *
 *   <StudentPicker value={id} onChange={(s) => setId(s?.id ?? null)} optional />             // formulário
 *   <StudentPicker mode="filter" value={id} onChange={(s) => setId(s?.id ?? null)} />       // toolbar
 */
export function StudentPicker({
  value,
  onChange,
  mode = "form",
  optional = false,
  label,
  emptyLabel,
  initial,
  disabled,
  className,
  excludeIds,
}: StudentPickerProps) {
  const uid = useId();
  const searchId = `${uid}-busca`;
  const selectId = `${uid}-aluno`;
  const hintId = `${uid}-hint`;
  const isFilter = mode === "filter";

  const [text, setText] = useState("");
  const [picked, setPicked] = useState<StudentOption | null>(null);
  const q = useDebouncedValue(text.trim(), 300);
  const search = useStudentSearch(q);

  const results = (search.data?.items ?? []).filter((s) => !excludeIds?.includes(s.id) || s.id === value);
  const total = search.data?.total ?? 0;

  // Quem é o aluno de `value`? escolhido agora > objeto do registro > resultados da busca.
  const known: StudentOption | null =
    value === null
      ? null
      : picked?.id === value
        ? picked
        : initial?.id === value
          ? initial
          : (results.find((s) => s.id === value) ?? null);
  // Fora dos resultados (edição de aluno antigo): resolve por id, só quando a busca já assentou.
  const byId = useStudentById(value, known === null && !search.isPending);
  const current: StudentOption | null = known ?? (byId.data && byId.data.id === value ? byId.data : null);

  const options = current ? [current, ...results.filter((s) => s.id !== current.id)] : results;

  const selectLabel = label ?? (isFilter ? "Filtrar por aluno" : "Aluno");
  const emptyOption = emptyLabel ?? (isFilter ? "Todos os alunos" : optional ? "Sem aluno" : "Selecione…");

  const unresolved = value !== null && current === null;
  const searchError = search.error ? errorMessage(search.error, "Não foi possível carregar os alunos.") : null;
  const currentError =
    unresolved && byId.error ? errorMessage(byId.error, "Não foi possível carregar o aluno atual.") : null;
  const status = search.isLoading
    ? "Carregando alunos…"
    : !search.error && results.length === 0 && !current
      ? "Nenhum aluno encontrado."
      : total > STUDENT_SEARCH_LIMIT
        ? `Mostrando ${STUDENT_SEARCH_LIMIT} de ${total} alunos. Digite para refinar a busca.`
        : null;

  function handleSelect(raw: string) {
    const next = raw === "" ? null : (options.find((s) => String(s.id) === raw) ?? null);
    setPicked(next);
    onChange(next);
  }

  const searchBox = (
    <div className={cn("relative", isFilter && "w-36")}>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input
        id={searchId}
        type="search"
        className="pl-8"
        placeholder={isFilter ? "Buscar aluno…" : "Digite o nome do aluno…"}
        aria-label={isFilter ? "Buscar aluno" : undefined}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        // Dentro de um <form> o Enter dispararia o submit do formulário inteiro (gravava o registro
        // SEM aluno). A busca é por digitação (debounce), então o Enter não deve fazer nada aqui.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
    </div>
  );

  const nativeSelect = (
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
        <option value={String(value)}>{byId.isError ? `Aluno #${String(value)}` : "Carregando aluno…"}</option>
      )}
      {options.map((s) => (
        <option key={s.id} value={String(s.id)}>
          {optionLabel(s)}
        </option>
      ))}
    </NativeSelect>
  );

  // Miniatura do aluno escolhido (foto ou iniciais) ao lado do select.
  const select = current ? (
    <div className={cn("flex items-center gap-2", !isFilter && "[&>select]:flex-1")}>
      <StudentAvatar name={current.name} photo={current.photo} />
      {nativeSelect}
    </div>
  ) : (
    nativeSelect
  );

  const messages = (
    <>
      {status && (
        <p
          id={hintId}
          role="status"
          data-testid="student-picker-status"
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
      <label htmlFor={searchId} className="text-sm font-medium">Buscar aluno</label>
      {searchBox}
      <label htmlFor={selectId} className="text-sm font-medium">{selectLabel}</label>
      {select}
      {messages}
    </div>
  );
}
