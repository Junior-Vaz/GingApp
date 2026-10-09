# GingApp — Painel de gestão (React)

SPA (React 19 + Vite + TanStack Router/Query + shadcn/Radix + Tailwind 4) do painel de mestres e
professores. Projeto **independente** (sem workspace compartilhado), mesmo visual do app do aluno.

```
npm ci
cp .env.example .env     # VITE_API_URL (padrão http://localhost:3000/api)
npm run dev | build | lint | test
```

Acesso: somente `MESTRE` e `PROFESSOR` (userType MEMBER). Aluno/responsável é barrado no login
(`lib/auth.ts`) e no guard de rotas (`routes/_app.tsx`). Sessão em `gestao_token`/`gestao_user`
(não colide com o app, que usa `mb_*`). A autorização real é do backend (`@CanAccess`).

## Estrutura

| Onde | O quê |
| --- | --- |
| `src/routes/_app.<modulo>.tsx` | **1 arquivo por rota** (fino: só `createFileRoute` + componente). Já existem as 15. |
| `src/modules/<modulo>/` | Páginas, tabelas, formulários, schemas e hooks **do módulo** (pasta própria de cada agente). |
| `src/components/painel/` | Componentes reutilizáveis do painel (abaixo). |
| `src/components/ui/` | shadcn (não editar à mão; lint ignora). |
| `src/lib/` | `api` (fetch + 401), `session`, `auth`, `nav` (menu), `crud` (hooks CRUD), `format`. |
| `src/routeTree.gen.ts` | Gerado pelo plugin do router; **commitado** (o `tsc` do build depende dele). |

Menu: edite **uma linha** em `src/lib/nav.ts` (`NAV_ITEMS`; `roles` opcional restringe por papel).

## Componentes (`src/components/painel`)

`PageHeader`, `StatCard`, `DataTable` (busca sem acento, ordenação por cabeçalho, paginação no
cliente ou no servidor via prop `server`, estados loading/vazio/erro), `FormDialog` (Dialog ou Sheet + react-hook-form + zod),
`ConfirmDialog` (substitui `confirm()`), `EmConstrucao`. Dados: `createCrud` em `lib/crud.ts`
(list/useOne/create/update/remove; invalida cache, toast de sucesso e de erro via sonner).

## Exemplo de módulo (CRUD completo)

```tsx
// src/modules/turmas/turmas-page.tsx
import { useState } from "react";
import { z } from "zod";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCrud } from "@/lib/crud";

interface Turma { id: number; name: string }
const turmas = createCrud<Turma, { name: string }>("/classes");
const schema = z.object({ name: z.string().min(2, "Informe o nome.") });
type Values = z.infer<typeof schema>;

export function TurmasPage() {
  const list = turmas.useList();
  const create = turmas.useCreate();
  const update = turmas.useUpdate();
  const remove = turmas.useRemove();
  const [editing, setEditing] = useState<Turma | "new" | null>(null);
  const [deleting, setDeleting] = useState<Turma | null>(null);

  const columns: Column<Turma>[] = [{ id: "name", header: "Nome", sortValue: (t) => t.name }];

  return (
    <>
      <PageHeader title="Turmas" actions={<Button onClick={() => setEditing("new")}>Nova turma</Button>} />
      <DataTable
        columns={columns} data={list.data} isLoading={list.isLoading} error={list.error}
        onRetry={() => void list.refetch()} getRowId={(t) => t.id} searchText={(t) => t.name}
        rowActions={(t) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>Editar</Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(t)}>Excluir</Button>
          </>
        )}
      />
      <FormDialog<Values>
        open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "new" ? "Nova turma" : "Editar turma"} schema={schema}
        defaultValues={{ name: editing && editing !== "new" ? editing.name : "" }}
        onSubmit={(v) => editing === "new" || !editing
          ? create.mutateAsync(v) : update.mutateAsync({ id: editing.id, data: v })}
      >
        {(form) => (
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        )}
      </FormDialog>
      <ConfirmDialog
        open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir turma?" description={deleting?.name} confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
```

Depois, na rota: `component: TurmasPage` em `src/routes/_app.turmas.tsx` (troque o `EmConstrucao`).
Chamadas que não são CRUD: `api.get/post/patch/delete` de `@/lib/api` + `useQuery`; erros por
`notifyError(error)` (toast). `createCrud` usa PATCH para update e IDs numéricos (ajuste o 3º
genérico se o recurso usar string).

## Lista paginada no servidor (padrão; referência: `src/modules/alunos`)

O backend limita as listas a 50 e aceita `limit` (1..200), `offset`, `q` e filtros próprios (veja
`backend/src/interface/http/<modulo>/dto/list-*-query.dto.ts`); o total vem no header
`X-Total-Count`. Para converter um módulo (`useList` -> servidor):

```tsx
const lp = useListParams({ pageSize: 10, filters: { status: "", unitId: "" } }); // 1. estado -> params
const list = students.usePage(lp.params);                  // 2. GET ?limit&offset&q&status&unitId -> { items, total, isFetching }
<DataTable data={list.items} isLoading={list.isLoading} error={list.error} getRowId={(s) => s.id}
  server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}  // 3. busca (debounce 300ms) e paginação no servidor
  toolbar={<NativeSelect value={lp.filters.status} onChange={(e) => lp.setFilter("status", e.target.value)} />} /> // filtro volta à pág. 1
```

- Não passe `searchText`/`pageSize` com `server` (ignorados); a ordenação por cabeçalho é local, só na página corrente.
- `createCrud(...).useList()` e o `DataTable` sem `server` seguem existindo (cliente, aviso de teto de 50).
- 4. **Limpar campo no PATCH**: o backend aceita `null` nos campos opcionais (ausente = não mexe). Na edição envie
  `null` para o que o usuário esvaziou (`studentToUpdatePayload` em `modules/alunos/schema.ts`); na criação omita os vazios.
  Colunas obrigatórias (ex.: `name`, `status`) com `null` dão 400.
- Testes: ver `src/test/pagination.test.tsx` (getPage, usePage, tabela servidor) e `alunos.test.tsx` (mock de fetch que lê `query`).
- Atenção: o backend tem throttle global de 60 req/min por IP (E2E que cria muitos registros deve espaçar as chamadas).

## Docker

`docker build --build-arg VITE_API_URL=https://api.gingapp.com.br/api -t gingapp-painel .` (nginx, SPA).
