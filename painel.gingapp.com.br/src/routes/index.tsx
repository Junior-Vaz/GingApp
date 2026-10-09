import { createFileRoute, redirect } from "@tanstack/react-router";

// "/" -> "/dashboard" (o guard de /_app cuida de mandar para o login se não houver sessão).
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
