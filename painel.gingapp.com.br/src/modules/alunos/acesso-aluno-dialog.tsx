import { useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { CreateAccountDialog, ResetPasswordDialog } from "@/components/painel/account-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { useStudentAccessMutations, useStudentAccount } from "./acesso-api";
import type { Student } from "./schema";

/**
 * "Acesso do aluno": mostra se o aluno já tem login e permite criar o acesso (e-mail + senha provisória;
 * um e-mail já cadastrado no sistema só é vinculado) ou redefinir a senha (encerra as sessões dele).
 */
export function AcessoAlunoDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const query = useStudentAccount(student?.id ?? null);
  // O hook precisa de um id mesmo fechado; sem aluno nenhuma mutação é disparada.
  const mutations = useStudentAccessMutations(student?.id ?? 0);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);

  const account = query.data?.hasAccount ? query.data.account : undefined;

  return (
    <>
      <Dialog open={student !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acesso do aluno</DialogTitle>
            <DialogDescription>
              {student ? `Login de ${student.name} no aplicativo do aluno.` : "Login do aluno no aplicativo."}
            </DialogDescription>
          </DialogHeader>

          {query.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(query.error, "Não foi possível carregar o acesso do aluno.")}
            </p>
          )}
          {query.data && !query.data.hasAccount && (
            <p className="text-sm text-muted-foreground" data-testid="sem-acesso">
              Este aluno ainda não tem acesso ao aplicativo. Crie o login informando o e-mail e uma senha provisória.
            </p>
          )}
          {account && (
            <dl className="grid gap-2 text-sm" data-testid="com-acesso">
              <div>
                <dt className="text-muted-foreground">E-mail de acesso</dt>
                <dd className="font-medium">{account.email}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={account.status === "ACTIVE" ? "default" : "secondary"}>
                  {account.status === "ACTIVE" ? "Conta ativa" : "Conta inativa"}
                </Badge>
                {account.mustChangePassword && <Badge variant="outline">Troca de senha pendente</Badge>}
              </div>
            </dl>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            {query.data && !query.data.hasAccount && (
              <Button onClick={() => setCreating(true)}>
                <UserPlus /> Criar acesso
              </Button>
            )}
            {account && (
              <Button onClick={() => setResetting(true)}>
                <KeyRound /> Redefinir senha
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {student && (
        <>
          <CreateAccountDialog
            open={creating}
            onOpenChange={setCreating}
            title="Criar acesso do aluno"
            description={`Defina o e-mail e a senha provisória de ${student.name}.`}
            defaultEmail={student.email ?? ""}
            onSubmit={(payload) => mutations.createAccount.mutateAsync(payload)}
          />
          <ResetPasswordDialog
            open={resetting}
            onOpenChange={setResetting}
            title="Redefinir senha do aluno"
            description="As sessões abertas do aluno serão encerradas e ele deverá trocar a senha no próximo acesso."
            onSubmit={(newPassword) => mutations.resetPassword.mutateAsync(newPassword)}
          />
        </>
      )}
    </>
  );
}
