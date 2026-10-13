import { useState } from "react";
import { Check, Search, X } from "lucide-react";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useDebouncedValue } from "@/lib/list-params";
import { STUDENT_SEARCH_LIMIT, useStudentSearch, type StudentOption } from "@/lib/student-lookup";
import { cn } from "@/lib/utils";

/**
 * Seleção MÚLTIPLA de alunos (o `StudentPicker` é de um aluno só): busca no servidor (GET /students?q=&limit=20,
 * debounce 300ms), lista de resultados marcáveis e "chips" removíveis com os escolhidos. O Enter não faz nada
 * (não submete formulário). Controlado: o pai guarda os objetos escolhidos.
 */
export function StudentMultiPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: StudentOption[];
  onChange: (students: StudentOption[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim(), 300);
  const search = useStudentSearch(q);
  const results = (search.data?.items ?? []).filter((s) => s.status !== "INACTIVE");
  const chosen = new Set(value.map((s) => s.id));

  function toggle(student: StudentOption) {
    onChange(chosen.has(student.id) ? value.filter((s) => s.id !== student.id) : [...value, student]);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-3.5 size-4 text-muted-foreground md:top-2.5" />
        <Input
          type="search"
          className="pl-8"
          placeholder="Buscar aluno pelo nome…"
          aria-label="Buscar alunos"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      </div>

      {value.length > 0 && (
        <ul aria-label="Alunos escolhidos" className="flex flex-wrap gap-1.5" data-testid="student-multi-chips">
          {value.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pl-2 pr-0.5 text-xs font-semibold">
              <span className="max-w-40 truncate">{s.name}</span>
              <button
                type="button"
                aria-label={`Remover ${s.name}`}
                disabled={disabled}
                onClick={() => toggle(s)}
                className="grid size-6 place-items-center rounded-full outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul
        aria-label="Resultados da busca"
        className="max-h-36 divide-y overflow-y-auto rounded-md border"
        data-testid="student-multi-results"
      >
        {search.isLoading && <li className="px-3 py-2 text-xs text-muted-foreground">Carregando alunos…</li>}
        {search.error && (
          <li role="alert" className="px-3 py-2 text-xs text-destructive">
            {errorMessage(search.error, "Não foi possível carregar os alunos.")}
          </li>
        )}
        {!search.isLoading && !search.error && results.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">Nenhum aluno encontrado.</li>
        )}
        {results.map((s) => {
          const on = chosen.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(s)}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted",
                  on && "bg-secondary",
                )}
              >
                <StudentAvatar name={s.name} photo={s.photo} className="size-8" />
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                {on && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {(search.data?.total ?? 0) > STUDENT_SEARCH_LIMIT && (
        <p className="text-xs text-muted-foreground">
          Mostrando {STUDENT_SEARCH_LIMIT} de {search.data?.total} alunos. Digite para refinar a busca.
        </p>
      )}
    </div>
  );
}
