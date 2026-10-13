import { useState } from "react";
import { toast } from "sonner";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { ropeOf } from "@/lib/rope";
import { levelOptions, systems } from "@/modules/graduacoes/graduacoes-api";
import {
  equivalenceErrorMessage,
  useEquivalenceSuggestions,
  useSaveEquivalence,
  type EquivalenceLevel,
  type EquivalenceSuggestion,
} from "./equivalencias";
import { NativeSelect } from "./native-select";

const date = (iso: string) => fmt(dayOnly(iso), "dd/MM/yyyy");

interface Option {
  id: number;
  label: string;
  level: EquivalenceLevel;
}

function SuggestionRow({
  suggestion: s,
  options,
  studentId,
}: {
  suggestion: EquivalenceSuggestion;
  options: Option[];
  studentId: number;
}) {
  const save = useSaveEquivalence(studentId);
  const preset = s.declared ?? s.suggested;
  const [selected, setSelected] = useState(preset ? String(preset.id) : "");
  const [error, setError] = useState<string | null>(null);

  // A declarada/sugerida pode estar num sistema inativo (fora da lista): garante que a opção exista.
  const all = [...options];
  for (const l of [s.declared, s.suggested]) {
    if (l && !all.some((o) => o.id === l.id)) {
      all.push({ id: l.id, label: `${s.toSystem?.name ?? "Sistema do grupo"} — ${l.name}`, level: l });
    }
  }
  const target = all.find((o) => String(o.id) === selected)?.level;
  const mark =
    s.declared && selected === String(s.declared.id)
      ? "declarada"
      : s.suggested && selected === String(s.suggested.id)
        ? "sugerida"
        : null;

  async function run(recognize: boolean) {
    if (selected === "") return setError("Escolha o nível equivalente do seu grupo.");
    setError(null);
    try {
      await save.mutateAsync({
        fromLevelId: s.fromLevel.id,
        toLevelId: Number(selected),
        ...(recognize ? { recognizeForStudentId: studentId } : {}),
      });
      toast.success(recognize ? "Corda reconhecida e graduação criada." : "Equivalência declarada.");
    } catch (e) {
      setError(equivalenceErrorMessage(e, "Não foi possível salvar a equivalência. Tente novamente."));
    }
  }

  return (
    <li
      data-testid="equivalencia-item"
      aria-label={`Corda ${s.fromLevel.name} de ${s.fromOrganization.name}`}
      className="grid gap-2 rounded-md border bg-background p-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <RopeSwatch {...ropeOf(s.fromLevel)} size="sm" orientation="horizontal" />
        <span className="font-medium">{s.fromLevel.name}</span>
        <span className="text-muted-foreground">
          {s.fromSystem.name} · {s.fromOrganization.name} · {date(s.graduatedAt)}
        </span>
        {s.recognized && <Badge variant="default">Reconhecida</Badge>}
      </div>
      {!s.recognized && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            {target && <RopeSwatch {...ropeOf(target)} size="sm" orientation="horizontal" />}
            <NativeSelect
              aria-label={`Nível equivalente a ${s.fromLevel.name}`}
              className="min-w-0 flex-1"
              value={selected}
              disabled={save.isPending}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Selecione o nível…</option>
              {all.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            {mark && (
              <Badge variant="outline" data-testid="equivalencia-marca">
                {mark}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={save.isPending} onClick={() => void run(true)}>
              Reconhecer
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={save.isPending} onClick={() => void run(false)}>
              Só declarar equivalência
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * "Reconhecer corda" (só MESTRE): para cada corda compartilhada de outro grupo, escolhe o nível equivalente no sistema
 * do grupo (pré-selecionado com a equivalência declarada ou a sugerida). "Reconhecer" cria a graduação equivalente
 * no grupo ("Reconhecida") sem alterar a antiga; "Só declarar equivalência" apenas guarda a correspondência.
 */
export function ReconhecerCorda({ studentId }: { studentId: number }) {
  const suggestions = useEquivalenceSuggestions(studentId, true);
  const systemList = systems.useList();
  const options: Option[] = levelOptions(systemList.data).map((o) => ({ id: o.id, label: o.label, level: o.level }));
  const rows = suggestions.data ?? [];

  return (
    <div className="grid gap-2" data-testid="ficha-reconhecer">
      <h4 className="text-sm font-semibold">Reconhecer corda</h4>
      <p className="text-xs text-muted-foreground">
        Escolha o nível do seu grupo equivalente a cada corda de origem. Reconhecer cria a graduação no seu grupo, sem alterar a antiga.
      </p>
      {suggestions.isLoading && <p className="text-sm text-muted-foreground">Carregando as cordas…</p>}
      {suggestions.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(suggestions.error, "Não foi possível carregar as cordas de origem.")}
        </p>
      )}
      {suggestions.data && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma corda de outro grupo para reconhecer.</p>
      )}
      {rows.length > 0 && (
        <ul className="grid gap-2">
          {rows.map((s, i) => (
            <SuggestionRow key={`${s.fromLevel.id}-${s.graduatedAt}-${i}`} suggestion={s} options={options} studentId={studentId} />
          ))}
        </ul>
      )}
    </div>
  );
}
