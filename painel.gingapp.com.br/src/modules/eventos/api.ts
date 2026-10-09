import { createCrud } from "@/lib/crud";
import type { EventItem, EventPayload } from "./types";

export const events = createCrud<EventItem, EventPayload>("/events", {
  created: "Evento criado.",
  updated: "Evento atualizado.",
  removed: "Evento excluído.",
});