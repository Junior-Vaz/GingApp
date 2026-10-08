import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./styles.css";
import { router, queryClient } from "./router";
import { setUnauthorizedHandler } from "@/lib/api";

// 401 em qualquer chamada: a sessão já foi limpa pelo api.ts; aqui limpamos o cache e
// voltamos ao login (com redirect para a página atual).
setUnauthorizedHandler(() => {
  queryClient.clear();
  const current = router.state.location;
  if (current.pathname !== "/login") {
    void router.navigate({ to: "/login", search: { redirect: current.href } });
  }
});

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
