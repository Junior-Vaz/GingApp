import { createContext, useContext } from "react";

export type Announce = (message: string) => void;

export const AnnounceContext = createContext<Announce>(() => undefined);

/** Anuncia uma mensagem curta para leitores de tela (ex.: "Resultado salvo"). Fora do provedor não faz nada. */
export const useAnnounce = (): Announce => useContext(AnnounceContext);
