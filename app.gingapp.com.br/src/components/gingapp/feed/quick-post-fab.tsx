import { useRouterState } from "@tanstack/react-router";
import { useFeedSettings } from "@/lib/feed";
import { PostComposer } from "./post-composer";

/**
 * Botão flutuante de canto para publicar rápido, de qualquer tela do app. Só existe com o feed LIGADO e quando o usuário
 * pode postar; carregando, erro ou desligado = nada na tela. Na página do Grupo (/feed) já há a barra de criação, então
 * o botão some ali.
 */
export function QuickPostFab() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const settings = useFeedSettings();
  const data = settings.data;
  if (!data || data.enabled !== true || !data.canPost || pathname === "/feed") return null;
  return <PostComposer settings={data} variant="fab" />;
}
