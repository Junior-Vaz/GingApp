import { useState } from "react";
import { Dices } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "./announce-context";
import { useGenerate } from "./api";
import { chaveamentoErrorMessage } from "./errors";
import { hasPlayedMatches } from "./helpers";
import { SEEDING_LABEL, type OperatorCategory, type Seeding } from "./types";

const SEEDING_HINT: Record<Seeding, string> = {
  RANDOM: "Sorteio livre entre todos os atletas.",
  BY_SEED: "Quem tem semente fica como cabeça de chave (1 e 2 só se encontram na final). Sem semente vai para o fim, sorteado.",
  AVOID_SAME_GROUP: "Sorteio que evita, sempre que possível, atletas do mesmo grupo na 1ª rodada.",
};

/** Sorteio: modo + "Gerar chave" (SETUP) ou "Sortear de novo" com confirmação (já gerada e sem resultados). */
export function DrawPanel({ eventId, category, canEdit }: { eventId: number; category: OperatorCategory; canEdit: boolean }) {
  const generate = useGenerate(eventId);
  const announce = useAnnounce();
  const [seeding, setSeeding] = useState<Seeding>("RANDOM");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const generated = category.matches.length > 0;
  const played = hasPlayedMatches(category) || category.status === "FINISHED";
  const count = category.competitors.length;
  const modes: Seeding[] = ["RANDOM", "BY_SEED", "AVOID_SAME_GROUP"];

  if (!canEdit) return null;

  async function run(regenerate: boolean) {
    setError("");
    try {
      await generate.mutateAsync({ categoryId: category.id, seeding, ...(regenerate ? { regenerate: true } : {}) });
      announce(regenerate ? "Chave sorteada de novo." : "Chave gerada.");
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
    }
  }

  const config =
    category.format === "GROUPS_KNOCKOUT"
      ? ` Serão ${String(category.groupCount ?? 0)} grupos, com ${String(category.advancePerGroup ?? 0)} classificado(s) por grupo para o mata-mata.`
      : category.format === "ROUND_ROBIN"
        ? " Todos enfrentam todos."
        : "";

  return (
    <section aria-label="Sorteio" className="grid gap-3 rounded-lg border bg-card p-4" data-testid="draw-panel">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <Dices className="size-5" aria-hidden /> Sorteio
      </h2>
      {generated && played ? (
        <p className="text-sm text-muted-foreground" data-testid="draw-locked">
          Há lutas em andamento ou encerradas, então não dá para sortear de novo. Para refazer o sorteio, desfaça os resultados (na ordem inversa).
        </p>
      ) : (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Como sortear</legend>
            {modes.map((mode) => (
              <label key={mode} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="radio" name="seeding" className="mt-1" checked={seeding === mode} onChange={() => setSeeding(mode)} />
                <span>
                  <span className="block font-medium">{SEEDING_LABEL[mode]}</span>
                  <span className="block text-xs text-muted-foreground">{SEEDING_HINT[mode]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            {count} {count === 1 ? "atleta" : "atletas"} na categoria.{config}
            {count < 2 ? " São necessários pelo menos 2 atletas." : ""}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {generated ? (
            <Button variant="outline" size="lg" className="h-12" disabled={generate.isPending} onClick={() => setConfirm(true)}>
              Sortear de novo
            </Button>
          ) : (
            <Button size="lg" className="h-12" disabled={count < 2 || generate.isPending} onClick={() => void run(false)}>
              {generate.isPending ? "Gerando…" : "Gerar chave"}
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Sortear de novo?"
        description="A chave atual será apagada e uma nova será sorteada com os mesmos atletas. Isso só é possível enquanto nenhuma luta tiver começado."
        confirmLabel="Sortear de novo"
        onConfirm={() => run(true)}
      />
    </section>
  );
}
