import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { INVITE_FAILED_MESSAGE, INVITE_SENT_MESSAGE, type CreateAccountPayload } from "@/lib/provisional-password";

/** Login (User) de um aluno/responsável, sem nada sensível (o backend nunca devolve senha/hash). */
export interface MemberAccount {
  userId: number;
  name: string;
  email: string;
  status: string;
  role: string | null;
  /** A senha atual foi definida pelo Mestre/Professor: a pessoa deve trocá-la no primeiro acesso. */
  mustChangePassword: boolean;
  /** 2FA ativo na conta (só a flag): habilita "Redefinir 2FA" para o Mestre. */
  twoFactorEnabled?: boolean;
}

/** GET /students/:id/account */
export interface StudentAccountState {
  hasAccount: boolean;
  account?: MemberAccount;
}

/** POST /students/:id/account */
export interface StudentAccountResult {
  studentId: number;
  /** true = o e-mail já era usuário do sistema e foi apenas vinculado (senha dele intocada). */
  linkedExistingUser: boolean;
  account: MemberAccount;
  /** Com sendInvite=true: o e-mail de convite foi enviado? (false = o acesso existe, mas o e-mail falhou.) */
  inviteSent?: boolean;
  /** Sem `password` no corpo: a senha provisória gerada pelo servidor (só existe nesta resposta; nunca guardar). */
  temporaryPassword?: string;
}

/** POST /students/:id/reset-password sem `newPassword`: o servidor gera a senha e a devolve (só nesta resposta). */
export interface GeneratedPasswordResult {
  temporaryPassword?: string;
}

/** Item de GET /students/:id/guardians. `consentPublicProfile` é SÓ leitura (vem do fluxo do Passaporte). */
export interface Guardian {
  id: number;
  studentId: number;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  consentPublicProfile: boolean;
  hasAccount: boolean;
  account: { userId: number; email: string; mustChangePassword: boolean } | null;
}

export interface GuardianAccountResult {
  guardian: Guardian;
  linkedExistingUser: boolean;
  /** Com sendInvite=true: o e-mail de convite foi enviado? */
  inviteSent?: boolean;
}

/** Corpo de POST /students/:id/guardians (sem consentPublicProfile: o backend recusa com 400). */
export interface GuardianInput {
  name: string;
  relationship?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  createAccount?: boolean | undefined;
  password?: string | undefined;
  /** Com createAccount: convite por e-mail (a pessoa define a própria senha; `password` não é enviada). */
  sendInvite?: boolean | undefined;
}

/** Corpo de PATCH /students/:id/guardians/:guardianId (`null` limpa relationship/phone/email). */
export interface GuardianUpdate {
  name?: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
}

export const LINKED_MESSAGE = "Esse e-mail já tinha cadastro: o acesso foi vinculado (a senha dele não mudou).";

/**
 * Resultado de criar acesso com convite: `true` = convite enviado; `false` = acesso criado mas o e-mail falhou
 * (avisar); `null` = nenhum convite foi pedido (ou o e-mail já era usuário e foi só vinculado).
 */
function inviteOutcome(
  result: { linkedExistingUser: boolean; inviteSent?: boolean },
  requested: boolean | undefined,
): boolean | null {
  if (!requested || result.linkedExistingUser) return null;
  return result.inviteSent === true;
}

const accountKey = (studentId: number) => ["student-access", studentId, "account"] as const;
const guardiansKey = (studentId: number) => ["student-access", studentId, "guardians"] as const;

export function useStudentAccount(studentId: number | null) {
  return useQuery({
    queryKey: accountKey(studentId ?? 0),
    queryFn: () => api.get<StudentAccountState>(`/students/${studentId}/account`),
    enabled: studentId !== null,
  });
}

export function useGuardians(studentId: number | null) {
  return useQuery({
    queryKey: guardiansKey(studentId ?? 0),
    queryFn: () => api.get<Guardian[]>(`/students/${studentId}/guardians`),
    enabled: studentId !== null,
  });
}

/** Mutações do acesso/responsáveis de UM aluno: avisam por toast (sucesso e erro) e atualizam as consultas. */
export function useStudentAccessMutations(studentId: number) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: accountKey(studentId) });
    void queryClient.invalidateQueries({ queryKey: guardiansKey(studentId) });
    void queryClient.invalidateQueries({ queryKey: ["crud", "/students"] });
  };
  const notify =
    <T, V = unknown>(success: string | ((result: T, variables: V) => string)) =>
    (result: T, variables: V) => {
      refresh();
      toast.success(typeof success === "function" ? success(result, variables) : success);
    };
  /** Como `notify`, mas com convite pedido e e-mail NÃO enviado avisa (warning) em vez de sucesso. */
  const notifyAccess =
    <T extends { linkedExistingUser: boolean; inviteSent?: boolean }, V extends { sendInvite?: boolean | undefined }>(
      created: string,
    ) =>
    (result: T, variables: V) => {
      refresh();
      const invite = inviteOutcome(result, variables.sendInvite);
      if (result.linkedExistingUser) toast.success(LINKED_MESSAGE);
      else if (invite === false) toast.warning(INVITE_FAILED_MESSAGE, { duration: 12_000 });
      else toast.success(invite === true ? `${created} ${INVITE_SENT_MESSAGE}` : created);
    };
  const onError = (error: unknown) => notifyError(error);

  const base = `/students/${studentId}`;
  return {
    createAccount: useMutation({
      mutationFn: (payload: CreateAccountPayload) => api.post<StudentAccountResult>(`${base}/account`, payload),
      onSuccess: notifyAccess<StudentAccountResult, CreateAccountPayload>("Acesso do aluno criado."),
      onError,
    }),
    resetPassword: useMutation({
      mutationFn: (newPassword: string) => api.post<void>(`${base}/reset-password`, { newPassword }),
      onSuccess: notify<void>("Senha redefinida. As sessões abertas do aluno foram encerradas."),
      onError,
    }),
    /**
     * Criar acesso em UM clique: só o e-mail; o servidor gera a senha provisória e a devolve (`temporaryPassword`).
     * Sem toast de sucesso (o cartão de credenciais é o aviso) e `gcTime: 0`: a senha não fica no cache de mutações.
     */
    quickCreateAccount: useMutation({
      mutationFn: (email: string) => api.post<StudentAccountResult>(`${base}/account`, { email }),
      onSuccess: refresh,
      onError,
      gcTime: 0,
    }),
    /** "Gerar nova senha fácil": reset sem `newPassword` (o servidor gera e devolve; sessões abertas são encerradas). */
    generatePassword: useMutation({
      mutationFn: () => api.post<GeneratedPasswordResult>(`${base}/reset-password`, {}),
      onSuccess: refresh,
      onError,
      gcTime: 0,
    }),
    createGuardian: useMutation({
      mutationFn: (payload: GuardianInput) => api.post<GuardianAccountResult>(`${base}/guardians`, payload),
      onSuccess: notifyAccess<GuardianAccountResult, GuardianInput>("Responsável cadastrado."),
      onError,
    }),
    updateGuardian: useMutation({
      mutationFn: ({ id, data }: { id: number; data: GuardianUpdate }) =>
        api.patch<Guardian>(`${base}/guardians/${id}`, data),
      onSuccess: notify<Guardian>("Responsável atualizado."),
      onError,
    }),
    removeGuardian: useMutation({
      mutationFn: (id: number) => api.delete<void>(`${base}/guardians/${id}`),
      onSuccess: notify<void>("Responsável removido."),
      onError,
    }),
    createGuardianAccount: useMutation({
      mutationFn: ({ id, ...payload }: { id: number } & CreateAccountPayload) =>
        api.post<GuardianAccountResult>(`${base}/guardians/${id}/account`, payload),
      onSuccess: notifyAccess<GuardianAccountResult, { id: number } & CreateAccountPayload>("Acesso do responsável criado."),
      onError,
    }),
    resetGuardianPassword: useMutation({
      mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
        api.post<void>(`${base}/guardians/${id}/reset-password`, { newPassword }),
      onSuccess: notify<void>("Senha redefinida. As sessões abertas do responsável foram encerradas."),
      onError,
    }),
  };
}
