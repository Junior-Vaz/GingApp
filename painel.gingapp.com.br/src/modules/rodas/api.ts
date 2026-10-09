import { createCrud } from "@/lib/crud";
import type { Roda, RodaPayload } from "./types";

export const rodas = createCrud<Roda, RodaPayload>("/rodas", {
  created: "Roda criada.",
  updated: "Roda atualizada.",
  removed: "Roda excluída.",
});