import { createFileRoute } from "@tanstack/react-router";
import { AttendancePage } from "@/components/gingapp/pages";

export const Route = createFileRoute("/_app/frequencia")({
  head: () => ({ meta: [{ title: "Minha frequência — GingApp" }] }),
  component: AttendancePage,
});
