import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { notifyError } from "@/lib/crud";
import { resetUserTwoFactor } from "@/lib/two-factor";

/**
 * "Redefinir 2FA" de OUTRO usuário do grupo (só o Mestre; o servidor recusa o resto): zera a verificação em duas
 * etapas, encerra as sessões da pessoa e ela pode ativá-la de novo. Para quem perdeu o aparelho e os códigos de
 * recuperação. Atualiza as listas ao concluir.
 */
export function ResetTwoFactorDialog({
  target,
  onClose,
}: {
  /** Usuário alvo (id do USUÁRIO, não do vínculo); `null` = fechado. */
  target: { userId: number; name: string } | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Redefinir 2FA?"
      description={
        target
          ? `A verificação em duas etapas de ${target.name} será desativada e as sessões abertas dela serão encerradas. Ela poderá ativá-la de novo quando quiser.`
          : undefined
      }
      confirmLabel="Redefinir 2FA"
      onConfirm={async () => {
        try {
          await resetUserTwoFactor(target!.userId);
        } catch (error) {
          notifyError(error, "Não foi possível redefinir o 2FA.");
          throw error; // mantém o diálogo aberto
        }
        toast.success("2FA redefinido. As sessões abertas foram encerradas.");
        void queryClient.invalidateQueries({ queryKey: ["crud"] });
        void queryClient.invalidateQueries({ queryKey: ["student-access"] });
      }}
    />
  );
}
