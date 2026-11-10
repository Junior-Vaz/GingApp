import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/modules/rodas/native-select";
import { useCreateCategory, useUpdateCategory } from "./api";
import { chaveamentoErrorMessage } from "./errors";
import { FORMATS, FORMAT_LABEL, LIMITS, type CategoryPayload, type OperatorCategory, type TournamentFormat, type TournamentCategorySummary } from "./types";

type Editable = Pick<OperatorCategory, "id" | "name" | "format" | "status" | "thirdPlace" | "groupCount" | "advancePerGroup"> | TournamentCategorySummary;

interface CategoryDialogProps {
  eventId: number;
  /** `"new"` cria; uma categoria edita; `null` fecha. */
  editing: Editable | "new" | null;
  onClose: () => void;
  /** Depois de criar, a página abre a aba da nova categoria. */
  onCreated?: (categoryId: number) => void;
}

export function CategoryDialog({ eventId, editing, onClose, onCreated }: CategoryDialogProps) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        {editing !== null && <CategoryForm key={editing === "new" ? "new" : editing.id} eventId={eventId} editing={editing} onClose={onClose} {...(onCreated ? { onCreated } : {})} />}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  eventId,
  editing,
  onClose,
  onCreated,
}: {
  eventId: number;
  editing: Editable | "new";
  onClose: () => void;
  onCreated?: (categoryId: number) => void;
}) {
  const create = useCreateCategory(eventId);
  const update = useUpdateCategory(eventId);
  const isNew = editing === "new";
  const locked = !isNew && editing.status !== "SETUP"; // fora de SETUP só o nome muda
  const [name, setName] = useState(isNew ? "" : editing.name);
  const [format, setFormat] = useState<TournamentFormat>(isNew ? "SINGLE_ELIMINATION" : editing.format);
  const [thirdPlace, setThirdPlace] = useState(isNew ? true : editing.thirdPlace);
  const [groupCount, setGroupCount] = useState(String(isNew ? 2 : (editing.groupCount ?? 2)));
  const [advance, setAdvance] = useState(String(isNew ? 2 : (editing.advancePerGroup ?? 2)));
  const [error, setError] = useState("");
  const pending = create.isPending || update.isPending;
  const hasThird = format !== "ROUND_ROBIN";
  const isGroups = format === "GROUPS_KNOCKOUT";

  async function submit() {
    setError("");
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > LIMITS.nameMax) return setError(`Informe o nome da categoria (até ${String(LIMITS.nameMax)} caracteres).`);
    const groups = Number(groupCount);
    const adv = Number(advance);
    if (isGroups && !locked) {
      if (!Number.isInteger(groups) || groups < LIMITS.groupCountMin || groups > LIMITS.groupCountMax)
        return setError(`Número de grupos: de ${String(LIMITS.groupCountMin)} a ${String(LIMITS.groupCountMax)}.`);
      if (!Number.isInteger(adv) || adv < LIMITS.advanceMin || adv > LIMITS.advanceMax)
        return setError(`Classificados por grupo: de ${String(LIMITS.advanceMin)} a ${String(LIMITS.advanceMax)}.`);
    }
    try {
      if (isNew) {
        const body: CategoryPayload = {
          name: trimmed,
          format,
          ...(hasThird ? { thirdPlace } : {}),
          ...(isGroups ? { groupCount: groups, advancePerGroup: adv } : {}),
        };
        const created = await create.mutateAsync(body);
        onCreated?.(created.id);
      } else {
        const data: CategoryPayload = locked
          ? { name: trimmed }
          : {
              name: trimmed,
              format,
              thirdPlace: hasThird ? thirdPlace : false,
              groupCount: isGroups ? groups : null,
              advancePerGroup: isGroups ? adv : null,
            };
        await update.mutateAsync({ id: editing.id, data });
      }
      onClose();
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isNew ? "Nova categoria" : "Editar categoria"}</DialogTitle>
        <DialogDescription>
          {locked ? "A chave já foi gerada: só o nome pode mudar." : "Ex.: Adulto masculino até 70 kg."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="cat-name">Nome da categoria</Label>
          <Input id="cat-name" value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cat-format">Formato</Label>
          <NativeSelect id="cat-format" value={format} disabled={locked} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
            {FORMATS.map((f) => (
              <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
            ))}
          </NativeSelect>
        </div>
        {hasThird && (
          <div className="flex items-center gap-3">
            <Checkbox id="cat-third" checked={thirdPlace} disabled={locked} onCheckedChange={(v) => setThirdPlace(v === true)} />
            <Label htmlFor="cat-third" className="font-normal">Disputa de 3º lugar</Label>
          </div>
        )}
        {isGroups && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="cat-groups">Número de grupos</Label>
              <Input id="cat-groups" inputMode="numeric" value={groupCount} disabled={locked} onChange={(e) => setGroupCount(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cat-advance">Classificados por grupo</Label>
              <Input id="cat-advance" inputMode="numeric" value={advance} disabled={locked} onChange={(e) => setAdvance(e.target.value)} />
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button disabled={pending} onClick={() => void submit()}>{pending ? "Salvando…" : isNew ? "Criar categoria" : "Salvar"}</Button>
      </DialogFooter>
    </>
  );
}
