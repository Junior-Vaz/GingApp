import { useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formKeys, notifyFormsError } from "./api";
import { NewFormDialog } from "./new-form-dialog";
import { useOpenForm } from "./navigation";
import type { FormListItem, Id } from "./types";

/**
 * Botão "Formulário de inscrição" da linha do evento: abre o formulário que já existe para o evento ou, se não houver
 * (ou só houver arquivados), abre o "Novo formulário" já ligado ao evento, com a escolha do modelo.
 */
export function EventFormLink({ event }: { event: { id: Id; title: string } }) {
  const client = useQueryClient();
  const openForm = useOpenForm();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const page = await client.fetchQuery({
        queryKey: [...formKeys.root, "by-event", String(event.id)],
        queryFn: () =>
          api.getPage<FormListItem>("/event-forms", { eventId: event.id, limit: 20, offset: 0 }),
        staleTime: 0,
      });
      const existing = page.items.find((form) => form.status !== "ARCHIVED");
      if (existing) openForm(existing.id);
      else setCreating(true);
    } catch (error) {
      notifyFormsError(error, "Não foi possível abrir o formulário de inscrição.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        aria-label={`Formulário de inscrição de ${event.title}`}
        onClick={() => void handleClick()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ClipboardList />} Formulário de inscrição
      </Button>
      <NewFormDialog
        open={creating}
        onOpenChange={setCreating}
        presetEvent={event}
        onCreated={(form) => openForm(form.id)}
      />
    </>
  );
}
