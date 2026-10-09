import { DataTable, type Column } from "@/components/painel/data-table";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";

import { locationOf, useUnits, type Unit } from "./units";

const columns: Column<Unit>[] = [
  {
    id: "name",
    header: "Unidade",
    sortValue: (u) => u.name,
    cell: (u) => (
      <span className="flex items-center gap-2 font-semibold">
        {u.name}
        {u.isMain && <Badge variant="secondary">Matriz</Badge>}
      </span>
    ),
  },
  { id: "address", header: "Endereço", sortValue: (u) => u.address, cell: (u) => u.address ?? "-" },
  { id: "location", header: "Cidade / UF", sortValue: locationOf, cell: locationOf },
  {
    id: "status",
    header: "Situação",
    sortValue: (u) => u.status,
    cell: (u) =>
      u.status === "ACTIVE" ? <Badge>Ativa</Badge> : <Badge variant="outline">Inativa</Badge>,
  },
];

export function UnidadesPage() {
  const list = useUnits();
  return (
    <div>
      <PageHeader
        title="Unidades"
        description="Matriz e filiais do grupo. Somente consulta: o cadastro de unidades ainda não existe na API."
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(u) => u.id}
        searchText={(u) => `${u.name} ${u.address ?? ""} ${locationOf(u)}`}
        searchPlaceholder="Buscar unidade..."
        emptyMessage="Nenhuma unidade cadastrada."
      />
    </div>
  );
}
