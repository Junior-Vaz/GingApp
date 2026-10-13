import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/modules/alunos/native-select";
import { ApprovalLinkDialog } from "./link-aprovacao-dialog";
import {
  TRANSFERS_KEY,
  type ApprovalLink,
  TRANSFER_NOTE_MAX,
  originOrganizations,
  requestTransfer,
  transferErrorMessage,
} from "./transfer-api";

export const TRANSFER_SENT_MESSAGE = "Pedido enviado; a pessoa (ou responsável) precisa aprovar no app.";

/**
 * Mini-formulário do pedido de transferência (POST /transfers): unidade de destino e observação são opcionais.
 * Se o servidor responder FROM_ORGANIZATION_REQUIRED (a pessoa está em mais de um grupo), pede o grupo de origem
 * da lista devolvida e reenvia com `fromOrganizationId`. Nada é criado no grupo até a pessoa aprovar pelo app.
 */
export function SolicitarTransferenciaForm({
  personId,
  personName,
  onBack,
  onSent,
}: {
  personId: number;
  personName: string;
  onBack: () => void;
  onSent: () => void;
}) {
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [origins, setOrigins] = useState<{ id: number; name: string }[] | null>(null);
  const [fromOrganizationId, setFromOrganizationId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Adulto sem login: o servidor devolve o link de aprovação (só nesta resposta); o diálogo fecha o fluxo ao ser fechado.
  const [link, setLink] = useState<ApprovalLink | null>(null);

  async function submit() {
    if (origins && fromOrganizationId === "") {
      setError("Escolha o grupo de origem da pessoa.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const created = await requestTransfer({
        personId,
        unitId: unitId ?? undefined,
        note: note.trim() || undefined,
        fromOrganizationId: fromOrganizationId ? Number(fromOrganizationId) : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: TRANSFERS_KEY });
      toast.success(TRANSFER_SENT_MESSAGE);
      if (created?.approvalLink) setLink(created.approvalLink);
      else onSent();
    } catch (e) {
      const found = originOrganizations(e);
      if (found) {
        setOrigins(found);
        setError(
          found.length > 0
            ? "Esta pessoa está em mais de um grupo. Escolha de qual grupo ela vem."
            : "Não foi possível listar os grupos de origem desta pessoa.",
        );
      } else {
        setError(transferErrorMessage(e, "Não foi possível enviar o pedido. Tente novamente."));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      data-testid="transfer-request-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        O pedido de transferência de <strong>{personName}</strong> vai para a própria pessoa (ou o responsável, se for
        menor), que precisa aprovar pelo app. Enquanto isso, nada muda no seu grupo.
      </p>

      {origins && origins.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="transfer-from">Grupo de origem</Label>
          <NativeSelect
            id="transfer-from"
            value={fromOrganizationId}
            onChange={(e) => setFromOrganizationId(e.target.value)}
            disabled={sending}
          >
            <option value="">Selecione…</option>
            {origins.map((o) => (
              <option key={o.id} value={String(o.id)}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <UnitPicker
        optional
        label="Unidade de destino (opcional)"
        emptyLabel="Sem unidade"
        value={unitId}
        onChange={(u) => setUnitId(u?.id ?? null)}
        disabled={sending}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="transfer-note">Observação (opcional)</Label>
        <Textarea
          id="transfer-note"
          value={note}
          maxLength={TRANSFER_NOTE_MAX}
          disabled={sending}
          placeholder="Ex.: combinado com a própria pessoa na última aula."
          onChange={(e) => setNote(e.target.value)}
        />
        <p className="text-right text-xs text-muted-foreground">
          {note.length}/{TRANSFER_NOTE_MAX}
        </p>
      </div>

      {error && (
        <p role="alert" data-testid="transfer-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ApprovalLinkDialog
        link={link}
        personName={personName}
        onClose={() => {
          setLink(null);
          onSent();
        }}
      />

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={sending} onClick={onBack}>
          Voltar
        </Button>
        <Button type="submit" disabled={sending}>
          {sending ? "Enviando…" : "Enviar pedido"}
        </Button>
      </div>
    </form>
  );
}
