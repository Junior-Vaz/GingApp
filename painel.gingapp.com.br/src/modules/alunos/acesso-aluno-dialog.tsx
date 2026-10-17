import { useEffect, useState } from "react";
import { KeyRound, PencilLine, ShieldOff, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { CreateAccountDialog, ResetPasswordDialog } from "@/components/painel/account-dialogs";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { CredentialsCard } from "@/components/painel/credentials-card";
import { ResetTwoFactorDialog } from "@/components/painel/reset-two-factor-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import { LINKED_MESSAGE, useStudentAccessMutations, useStudentAccount } from "./acesso-api";
import { isValidEmail, type Student } from "./schema";

const NO_PASSWORD_MESSAGE =
  "O servidor não devolveu a senha provisória. Use 'Definir manualmente' para escolher uma senha.";

/** Credenciais mostradas no cartão. Só vivem neste estado, até "Concluir"/fechar. */
interface Credentials {
  title: string;
  email: string;
  password: string;
}

/**
 * "Acesso do aluno": mostra se o aluno já tem login. Criar acesso é UM clique (e-mail do cadastro + senha provisória
 * gerada pelo servidor, mostrada no cartão de credenciais); "Gerar nova senha fácil" redefine a senha também em um
 * clique (com confirmação, pois encerra as sessões abertas). Definir a senha à mão continua disponível como opção.
 */
export function AcessoAlunoDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const query = useStudentAccount(student?.id ?? null);
  // O hook precisa de um id mesmo fechado; sem aluno nenhuma mutação é disparada.
  const mutations = useStudentAccessMutations(student?.id ?? 0);
  const [creatingManually, setCreatingManually] = useState(false);
  const [resettingManually, setResettingManually] = useState(false);
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  const [resetting2fa, setResetting2fa] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  // Redefinir o 2FA é só do Mestre do grupo (o servidor responde 403 aos demais).
  const isMestre = useSessionUser()?.role === "MESTRE";

  const studentId = student?.id ?? null;
  // Trocou (ou fechou) o aluno: a senha provisória e o rascunho de e-mail não sobrevivem.
  useEffect(() => {
    setCredentials(null);
    setEmailDraft("");
  }, [studentId]);

  const account = query.data?.hasAccount ? query.data.account : undefined;
  const knownEmail = (student?.email ?? "").trim();
  const knownEmailOk = isValidEmail(knownEmail);
  const loginEmail = knownEmailOk ? knownEmail : emailDraft.trim();
  const canQuickCreate = isValidEmail(loginEmail) && !mutations.quickCreateAccount.isPending;

  function close() {
    setCredentials(null);
    setEmailDraft("");
    onClose();
  }

  /** Um clique: cria o login com o e-mail do aluno; o servidor gera a senha (que aparece no cartão). */
  async function quickCreate() {
    let result;
    try {
      result = await mutations.quickCreateAccount.mutateAsync(loginEmail);
    } catch {
      return; // erro já notificado (toast) pela mutação
    } finally {
      mutations.quickCreateAccount.reset();
    }
    if (result.linkedExistingUser) toast.success(LINKED_MESSAGE);
    else if (result.temporaryPassword)
      setCredentials({ title: "Acesso criado", email: result.account.email || loginEmail, password: result.temporaryPassword });
    else toast.error(NO_PASSWORD_MESSAGE);
  }

  /** Confirmado: gera a nova senha (encerra as sessões abertas) e mostra o cartão. Erro = diálogo de confirmação aberto. */
  async function generatePassword() {
    if (!account) return;
    let result;
    try {
      result = await mutations.generatePassword.mutateAsync();
    } finally {
      mutations.generatePassword.reset();
    }
    if (result?.temporaryPassword) {
      setCredentials({ title: "Nova senha gerada", email: account.email, password: result.temporaryPassword });
    } else {
      toast.error(NO_PASSWORD_MESSAGE);
    }
  }

  return (
    <>
      <Dialog open={student !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acesso do aluno</DialogTitle>
            <DialogDescription>
              {student ? `Login de ${student.name} no aplicativo do aluno.` : "Login do aluno no aplicativo."}
            </DialogDescription>
          </DialogHeader>

          {credentials && student ? (
            <CredentialsCard
              title={credentials.title}
              name={student.name}
              email={credentials.email}
              password={credentials.password}
              phone={student.phone}
            >
              <Button type="button" onClick={close}>
                Concluir
              </Button>
            </CredentialsCard>
          ) : (
            <>
              {query.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {query.error && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(query.error, "Não foi possível carregar o acesso do aluno.")}
                </p>
              )}
              {query.data && !query.data.hasAccount && (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground" data-testid="sem-acesso">
                    Este aluno ainda não tem acesso ao aplicativo. Com um clique o login é criado e o sistema gera uma
                    senha provisória fácil para você passar ao aluno.
                  </p>
                  {knownEmailOk ? (
                    <p className="text-sm">
                      Login: <span className="font-medium">{knownEmail}</span>
                    </p>
                  ) : (
                    <div className="grid gap-1.5">
                      <Label htmlFor="acesso-aluno-email">E-mail do aluno (será o login)</Label>
                      <Input
                        id="acesso-aluno-email"
                        type="email"
                        autoComplete="off"
                        placeholder="aluno@email.com"
                        value={emailDraft}
                        onChange={(event) => setEmailDraft(event.target.value)}
                      />
                    </div>
                  )}
                </div>
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
                    {account.twoFactorEnabled && <Badge variant="outline">2FA ativo</Badge>}
                  </div>
                </dl>
              )}

              <DialogFooter className="max-sm:gap-2">
                <Button variant="outline" onClick={close}>
                  Fechar
                </Button>
                {query.data && !query.data.hasAccount && (
                  <>
                    <Button variant="outline" onClick={() => setCreatingManually(true)}>
                      <PencilLine /> Definir senha manualmente
                    </Button>
                    <Button disabled={!canQuickCreate} onClick={() => void quickCreate()}>
                      <UserPlus /> {mutations.quickCreateAccount.isPending ? "Criando…" : "Criar acesso"}
                    </Button>
                  </>
                )}
                {account && isMestre && account.twoFactorEnabled && (
                  <Button variant="outline" onClick={() => setResetting2fa(true)}>
                    <ShieldOff /> Redefinir 2FA
                  </Button>
                )}
                {account && (
                  <>
                    <Button variant="outline" onClick={() => setResettingManually(true)}>
                      <KeyRound /> Definir manualmente
                    </Button>
                    <Button onClick={() => setConfirmingGenerate(true)}>
                      <Sparkles /> Gerar nova senha fácil
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ResetTwoFactorDialog
        target={resetting2fa && account ? { userId: account.userId, name: account.name } : null}
        onClose={() => setResetting2fa(false)}
      />

      <ConfirmDialog
        open={confirmingGenerate}
        onOpenChange={setConfirmingGenerate}
        variant="default"
        title="Gerar nova senha fácil?"
        description="As sessões abertas serão encerradas. O aluno entra com a senha nova e a troca no primeiro acesso."
        confirmLabel="Gerar nova senha"
        onConfirm={generatePassword}
      />

      {student && (
        <>
          <CreateAccountDialog
            open={creatingManually}
            onOpenChange={setCreatingManually}
            title="Criar acesso do aluno"
            description={`Defina o e-mail e a senha provisória de ${student.name}.`}
            defaultEmail={student.email ?? ""}
            onSubmit={(payload) => mutations.createAccount.mutateAsync(payload)}
          />
          <ResetPasswordDialog
            open={resettingManually}
            onOpenChange={setResettingManually}
            title="Redefinir senha do aluno"
            description="As sessões abertas do aluno serão encerradas e ele deverá trocar a senha no próximo acesso."
            onSubmit={(newPassword) => mutations.resetPassword.mutateAsync(newPassword)}
          />
        </>
      )}
    </>
  );
}
