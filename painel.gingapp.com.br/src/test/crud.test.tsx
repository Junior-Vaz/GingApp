import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { createCrud } from "@/lib/crud";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

interface Thing {
  id: number;
  name: string;
}
const things = createCrud<Thing, { name: string }>("/things", { created: "Criado!" });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("createCrud", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("list faz GET com query string; create faz POST e avisa por toast", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, [{ id: 1, name: "a" }]))
      .mockResolvedValueOnce(json(201, { id: 2, name: "b" }))
      .mockResolvedValue(json(200, [])); // refetch após invalidar
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => ({ list: things.useList({ status: "ACTIVE" }), create: things.useCreate() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.list.data).toEqual([{ id: 1, name: "a" }]));
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/things\?status=ACTIVE$/);

    await act(async () => {
      await result.current.create.mutateAsync({ name: "b" });
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/things$/);
    expect(init.method).toBe("POST");
    expect(toast.success).toHaveBeenCalledWith("Criado!");
  });

  it("erro da API vira toast.error com a mensagem do backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { message: "Sem permissão." })));
    const { result } = renderHook(() => things.useRemove(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync(5).catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalledWith("Sem permissão.");
  });
});
