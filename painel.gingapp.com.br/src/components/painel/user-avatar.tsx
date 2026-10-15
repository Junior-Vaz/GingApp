import { EntityAvatar } from "@/components/painel/entity-avatar";
import { useSessionUser } from "@/lib/session";

/**
 * Avatar do USUÁRIO LOGADO (foto de perfil da sessão, com iniciais como fallback). É o mesmo avatar do cabeçalho, do
 * menu "Mais" (celular), do rodapé da sidebar e da tela de perfil: uma só fonte (`user.photo` da sessão, mantida em dia
 * por `useSyncSessionFromMe` e pelo perfil) para a foto nunca divergir entre os lugares.
 */
export function UserAvatar({ className }: { className?: string | undefined }) {
  const user = useSessionUser();
  return <EntityAvatar name={user?.name ?? ""} photo={user?.photo} className={className} />;
}
