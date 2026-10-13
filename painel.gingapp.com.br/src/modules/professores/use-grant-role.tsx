import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreateAccountDialog } from "@/components/painel/account-dialogs";
import { api } from "@/lib/api";
import type { CreateAccountPayload } from "@/lib/provisional-password";
import { isLoginRequired, roleErrorMessage, useRefreshRoles, type RoleView } from "./roles-api";

/** Pedido de cargo: quem (a matrícula de aluno), qual cargo do grupo e o nome/e-mail só para as mensagens e o login. */
export interface GrantRequest {
  studentId: number;
  groupRoleId: number;
  /** Nome do cargo (só para as mensagens). */
  roleName: string;
  name: string;
  /** E-mail já conhecido da pessoa (sugerido ao criar o login, se ela ainda não tiver). */
  email?: string | null | undefined;
}

/**
 * Conceder um cargo (POST /roles/grant, só o Mestre). Se a pessoa ainda não tem login o servidor responde
 * 400 LOGIN_REQUIRED: o hook abre o diálogo de e-mail + senha provisória (ou convite por e-mail, quando o servidor
 * envia e-mail) e reenvia o MESMO pedido com os dados do acesso. Renderize `loginDialog` uma vez.
 */
export function useGrantRole(options: { onGranted?: () => void } = {}) {
  const refresh = useRefreshRoles();
  const [pending, setPending] = useState<GrantRequest | null>(null);
  const mutation = useMutation({
    mutationFn: ({ request, account }: { request: GrantRequest; account?: CreateAccountPayload | undefined }) =>
      api.post<RoleView>("/roles/grant", {
        studentId: request.studentId,
        groupRoleId: request.groupRoleId,
        ...account,
      }),
  });

  async function send(request: GrantRequest, account?: CreateAccountPayload): Promise<void> {
    await mutation.mutateAsync({ request, account });
    refresh();
    setPending(null);
    toast.success(`${request.name} agora é ${request.roleName}.`);
    options.onGranted?.();
  }

  /** Concede o cargo. `true` = concedido; `false` = não concedido (login a informar, ou erro já avisado em toast). */
  async function grant(request: GrantRequest): Promise<boolean> {
    try {
      await send(request);
      return true;
    } catch (error) {
      if (isLoginRequired(error)) setPending(request);
      else toast.error(roleErrorMessage(error, "Não foi possível conceder o cargo."));
      return false;
    }
  }

  /** Segundo passo (com o acesso informado). Relança o erro para o formulário continuar aberto. */
  async function submitAccount(account: CreateAccountPayload): Promise<void> {
    if (!pending) return;
    try {
      await send(pending, account);
    } catch (error) {
      toast.error(roleErrorMessage(error, "Não foi possível conceder o cargo."));
      throw error;
    }
  }

  const loginDialog: ReactNode = (
    <CreateAccountDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title="Criar acesso para conceder o cargo"
      description={
        pending
          ? `${pending.name} ainda não tem login. Informe o e-mail e uma senha provisória (ou envie um convite) para ${pending.roleName}.`
          : undefined
      }
      defaultEmail={pending?.email ?? ""}
      onSubmit={submitAccount}
    />
  );

  return { grant, isPending: mutation.isPending, awaitingLogin: pending !== null, loginDialog };
}
