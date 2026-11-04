import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearSession, loginAs } from "./login-as";

afterEach(() => clearSession());

describe("Fundo branco e margens laterais menores", () => {
  it(":root define o fundo como branco puro (oklch(1 0 0)) e o cartão continua branco", () => {
    const css = readFileSync(resolve(process.cwd(), "src", "styles.css"), "utf8");
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(root).toMatch(/--background:\s*oklch\(1 0 0\)/);
    expect(root).toMatch(/--card:\s*oklch\(1 0 0\)/);
    // Os cartões se distinguem do fundo pela borda: ela não pode ser branca.
    expect(root).toMatch(/--border:\s*oklch\(\.9\d*/);
  });

  it("o <main> usa px-3 no celular, md:px-5 no desktop e max-w-[90rem] (sem as margens antigas)", async () => {
    loginAs("MESTRE");
    const { AppShell } = await import("@/components/painel/app-shell");
    const { createRouter, createMemoryHistory, RouterProvider, createRootRoute } = await import("@tanstack/react-router");
    const root = createRootRoute({ component: () => <AppShell>conteúdo</AppShell> });
    const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const main = await screen.findByTestId("painel-main");
    const classes = main.className.split(/\s+/);
    expect(classes).toContain("px-3");
    expect(classes).toContain("md:px-5");
    expect(classes).toContain("max-w-[90rem]");
    expect(classes).not.toContain("px-4");
    expect(classes).not.toContain("md:px-8");
    expect(classes).not.toContain("max-w-7xl");
  }, 30_000); // monta o AppShell inteiro: passa dos 5 s do teto padrão sob a carga do gate completo
});
