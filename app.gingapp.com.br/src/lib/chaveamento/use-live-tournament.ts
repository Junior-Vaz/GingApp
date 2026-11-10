import { useEffect, useState } from "react";
import { INITIAL_LIVE_STATE, LiveConnection, type LiveState } from "./connection";

/**
 * Snapshot ao vivo do torneio público. Abre a conexão ao montar e a LIMPA por inteiro ao desmontar (EventSource,
 * timers e consulta em andamento). Trocar o token reinicia tudo do zero.
 */
export function useLiveTournament(token: string): LiveState {
  const [state, setState] = useState<LiveState>(INITIAL_LIVE_STATE);
  useEffect(() => {
    setState(INITIAL_LIVE_STATE);
    const connection = new LiveConnection(token, setState);
    connection.start();
    return () => connection.stop();
  }, [token]);
  return state;
}
