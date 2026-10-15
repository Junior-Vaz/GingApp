import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import { getUser, updateSessionUser, useSessionUser, type AuthUser } from "@/lib/session";
import { ME_QUERY_KEY, fetchMe } from "@/lib/two-factor";

/** Campos de GET /auth/me que a sessão do painel guarda (foto, nome, grupo, cargos). Nada além disso é copiado. */
const SESSION_FIELDS = [
  "name",
  "photo",
  "organizationName",
  "organizationLogoUrl",
  "roles",
  "roleKeys",
  "twoFactorEnabled",
] as const satisfies readonly (keyof AuthUser)[];

/** Mescla no usuário da sessão só o que mudou (evita re-render em cadeia quando nada mudou). */
export function syncSessionFromMe(me: Partial<AuthUser>): void {
  const current = getUser();
  if (!current) return;
  const patch: Partial<AuthUser> = {};
  for (const key of SESSION_FIELDS) {
    if (me[key] === undefined) continue;
    if (JSON.stringify(me[key]) !== JSON.stringify(current[key]))
      Object.assign(patch, { [key]: me[key] });
  }
  if (Object.keys(patch).length > 0) updateSessionUser(patch);
}

/**
 * Mantém a sessão do painel em dia com GET /auth/me: o login pode não trazer a foto/cargos (sessões antigas) e a
 * foto/nome mudam no perfil ou em outro aparelho. Roda ao abrir o painel (e de novo quando o cache vence).
 */
export function useSyncSessionFromMe(): void {
  const user = useSessionUser();
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (query.data) syncSessionFromMe(query.data);
  }, [query.data]);
}

/** PATCH /auth/me/profile { photo }: foto da PRÓPRIA conta (User.photo). `null` remove. Atualiza a sessão. */
export async function updateAccountPhoto(photo: string | null): Promise<AuthUser> {
  const me = await api.patch<AuthUser>("/auth/me/profile", { photo });
  syncSessionFromMe({ ...me, photo: me.photo ?? null });
  return me;
}

/** GET /people/me/ficha (parte usada pelo perfil). A pessoa pode não ter ficha (404): o perfil mostra só o essencial. */
export interface MyPerson {
  id: number;
  gingappCode: string;
  name: string;
  nickname: string | null;
  photo: string | null;
}

export const MY_PERSON_KEY = ["people", "me"] as const;
export const MY_CODE_KEY = ["people", "me", "code"] as const;

export async function fetchMyPerson(): Promise<MyPerson | null> {
  try {
    const ficha = await api.get<{ person: MyPerson }>("/people/me/ficha");
    return ficha.person;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export interface MyCode {
  personId: number;
  gingappCode: string;
  qrDataUrl: string;
}

export const fetchMyCode = () => api.get<MyCode>("/people/me/code");

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome (mínimo de 2 letras).")
    .max(120, "Máximo de 120 caracteres."),
  nickname: z.string().trim().max(40, "Máximo de 40 caracteres."),
  phone: z.string().trim().max(30, "Máximo de 30 caracteres."),
});
export type ProfileValues = z.infer<typeof profileSchema>;

/** Corpo de PATCH /people/me: nome, apelido e telefone (vazio = limpa apelido/telefone, como a API define). */
export function profilePayload(values: ProfileValues): {
  name: string;
  nickname: string | null;
  phone: string | null;
} {
  return {
    name: values.name.trim(),
    nickname: values.nickname.trim() || null,
    phone: values.phone.trim() || null,
  };
}

export const updateMyPerson = (
  body: ReturnType<typeof profilePayload> | { photo: string | null },
) => api.patch<{ person: MyPerson }>("/people/me", body);

/** Invalida o que depende da foto/nome do usuário (sessão, ficha, lista de equipe). */
export function useInvalidateProfile() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: MY_PERSON_KEY });
    void queryClient.invalidateQueries({ queryKey: ["crud", "/teachers"] });
  };
}
