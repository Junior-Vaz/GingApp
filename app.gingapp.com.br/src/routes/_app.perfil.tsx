import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/gingapp/profile";

export const Route = createFileRoute("/_app/perfil")({
  head: () => ({ meta: [{ title: "Meu perfil — GingApp" }] }),
  component: ProfilePage,
});
