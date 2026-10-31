import { useCallback } from "react";
import { useBlocker } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";

/**
 * Aviso ao sair com alterações não salvas: bloqueia a navegação dentro do painel (pergunta antes) e o fechamento/recarga
 * da aba (aviso do navegador). Só pode ser renderizado dentro do roteador (as rotas o usam; o editor em si não depende dele).
 */
export function LeaveGuard({
  dirty,
  description = "Você tem alterações no formulário que ainda não foram salvas. Se sair agora, elas serão perdidas.",
}: {
  dirty: boolean;
  /** Texto do aviso (padrão: formulário). Outros editores (ex.: modelos de certificado) trocam o assunto. */
  description?: string;
}) {
  const shouldBlockFn = useCallback(() => true, []);
  const blocker = useBlocker({
    shouldBlockFn,
    enableBeforeUnload: dirty,
    disabled: !dirty,
    withResolver: true,
  });
  return (
    <ConfirmDialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open && blocker.status === "blocked") blocker.reset();
      }}
      title="Sair sem salvar?"
      description={description}
      confirmLabel="Sair sem salvar"
      cancelLabel="Continuar editando"
      onConfirm={() => {
        if (blocker.status === "blocked") blocker.proceed();
      }}
    />
  );
}
