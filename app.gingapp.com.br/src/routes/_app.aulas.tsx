import { createFileRoute } from "@tanstack/react-router";
import { ClassesPage } from "@/components/gingapp/pages";

export const Route = createFileRoute("/_app/aulas")({
  head: () => ({ meta: [{ title: "Minhas aulas — GingApp" }] }),
  component: ClassesPage,
});
