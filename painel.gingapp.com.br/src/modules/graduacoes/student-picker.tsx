import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useDebouncedValue } from "@/lib/list-params";
import { NativeSelect } from "@/modules/aulas/native-select";
import { STUDENT_SEARCH_LIMIT, useStudentSearch, type StudentOption } from "./graduacoes-api";

interface StudentPickerProps {
  /** Aluno escolhido (objeto completo: sobrevive a mudanças na busca). */
  selected: StudentOption | undefined;
  onSelect: (student: StudentOption | undefined) => void;
}

const optionLabel = (s: StudentOption) => `${s.name}${s.status === "INACTIVE" ? " (inativo)" : ""}`;

/**
 * Seletor de aluno com busca NO SERVIDOR: o campo "Buscar aluno" (debounce 300ms) consulta
 * `GET /students?q=&limit=20` e o select "Aluno" lista os resultados. O aluno selecionado é
 * mantido na lista mesmo que a busca mude e ele deixe de casar.
 */
export function StudentPicker({ selected, onSelect }: StudentPickerProps) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), 300);
  const search = useStudentSearch(q);

  const results = search.data?.items ?? [];
  const total = search.data?.total ?? 0;
  const options =
    selected && !results.some((s) => s.id === selected.id) ? [selected, ...results] : results;

  return (
    <div className="space-y-1.5">
      <label htmlFor="grad-aluno-busca" className="text-sm font-medium">Buscar aluno</label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          id="grad-aluno-busca"
          type="search"
          className="pl-8"
          placeholder="Digite o nome do aluno…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <label htmlFor="grad-aluno" className="text-sm font-medium">Aluno</label>
      <NativeSelect
        id="grad-aluno"
        value={selected ? String(selected.id) : ""}
        onChange={(e) => onSelect(options.find((s) => String(s.id) === e.target.value))}
      >
        <option value="">
          {search.isLoading ? "Carregando alunos…" : options.length === 0 ? "Nenhum aluno encontrado" : "Selecione…"}
        </option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>{optionLabel(s)}</option>
        ))}
      </NativeSelect>
      {total > STUDENT_SEARCH_LIMIT && (
        <p className="text-xs text-muted-foreground" data-testid="students-truncated">
          Mostrando {STUDENT_SEARCH_LIMIT} de {total} alunos. Digite para refinar a busca.
        </p>
      )}
      {search.error && (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage(search.error, "Não foi possível carregar os alunos.")}
        </p>
      )}
    </div>
  );
}
