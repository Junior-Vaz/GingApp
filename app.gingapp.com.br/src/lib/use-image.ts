import { useEffect, useState } from "react";

import { imageSrc } from "@/lib/uploads";

/** Imagem com fallback: sem `src`, ou se falhar (404/CORS), `src` vem null (o chamador mostra iniciais/ícone). */
export function useImage(src: string | null | undefined) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const resolved = src ? imageSrc(src) : "";
  return { src: resolved && !failed ? resolved : null, onError: () => setFailed(true) };
}
