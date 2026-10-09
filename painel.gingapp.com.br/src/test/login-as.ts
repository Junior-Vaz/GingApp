import { clearSession, saveSession, type AuthUser } from "@/lib/session";

/** Abre uma sessão de gestão com o papel dado (as páginas leem o papel de useSessionUser/useCan). */
export function loginAs(role: AuthUser["role"]): AuthUser {
  const user: AuthUser = {
    id: 1,
    name: role === "MESTRE" ? "Mestre" : "Professor",
    email: `${role.toLowerCase()}@x.com`,
    userType: "MEMBER",
    isSuperAdmin: false,
    organizationId: 1,
    organizationSlug: "g",
    role,
  };
  saveSession("tok", user);
  return user;
}

export { clearSession };
