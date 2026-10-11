import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";

/** Login (User) de um aluno/responsável, sem nada sensível (o backend nunca devolve senha/hash). */
export interface MemberAccount {
  userId: number;
  name: string;
  email: string;
  status: string;
  role: string | null;
  /** A senha atual foi definida pelo Mestre/Professor: a pessoa deve trocá-la no primeiro acesso. */
  mustChangePassword: boolean;
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
}

/** Corpo de POST /students/:id/guardians (sem consentPublicProfile: o backend recusa com 400). */
export interface GuardianInput {
  name: string;
  relationship?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  createAccount?: boolean | undefined;
  password?: string | undefined;
}

/** Corpo de PATCH /students/:id/guardians/:guardianId (`null` limpa relationship/phone/email). */
export interface GuardianUpdate {
  name?: string;
  relationship?: string | null;
  phone?: string | null;
  email?: string | null;
}

export const LINKED_MESSAGE = "Esse e-mail já tinha cadastro: o acesso foi vinculado (a senha dele não mudou).";

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
    <T>(success: string | ((result: T) => string)) =>
    (result: T) => {
      refresh();
      toast.success(typeof success === "function" ? success(result) : success);
    };
  const onError = (error: unknown) => notifyError(error);

  const base = `/students/${studentId}`;
  return {
    createAccount: useMutation({
      mutationFn: (payload: { email: string; password?: string }) =>
        api.post<StudentAccountResult>(`${base}/account`, payload),
      onSuccess: notify<StudentAccountResult>((r) => (r.linkedExistingUser ? LINKED_MESSAGE : "Acesso do aluno criado.")),
      onError,
    }),
    resetPassword: useMutation({
      mutationFn: (newPassword: string) => api.post<void>(`${base}/reset-password`, { newPassword }),
      onSuccess: notify<void>("Senha redefinida. As sessões abertas do aluno foram encerradas."),
      onError,
    }),
    createGuardian: useMutation({
      mutationFn: (payload: GuardianInput) => api.post<GuardianAccountResult>(`${base}/guardians`, payload),
      onSuccess: notify<GuardianAccountResult>((r) => (r.linkedExistingUser ? LINKED_MESSAGE : "Responsável cadastrado.")),
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
      mutationFn: ({ id, ...payload }: { id: number; email: string; password?: string }) =>
        api.post<GuardianAccountResult>(`${base}/guardians/${id}/account`, payload),
      onSuccess: notify<GuardianAccountResult>((r) =>
        r.linkedExistingUser ? LINKED_MESSAGE : "Acesso do responsável criado.",
      ),
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
