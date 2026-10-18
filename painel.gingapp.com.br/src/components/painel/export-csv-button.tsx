import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { QueryParams } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { buildCsv, downloadServerCsv, saveCsv, todayStamp, type CsvValue } from "@/lib/csv";

interface CommonProps {
  /** Nome base do arquivo (sem data nem extensão): "alunos" -> "alunos-2026-10-11.csv". */
  filename: string;
  label?: string;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
}

/** Exporta no SERVIDOR (listas grandes): GET autenticado em `path` com os filtros atuais da tela em `params`. */
export function ExportCsvButton({
  path,
  params = {},
  filename,
  label = "Exportar CSV",
  disabled,
  variant = "outline",
  friendlyError,
}: CommonProps & {
  path: string;
  params?: QueryParams;
  /** Mensagem amigável por erro (ex.: 403); devolvendo texto, ele substitui a do servidor no toast. */
  friendlyError?: (error: unknown) => string | undefined;
}) {
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      await downloadServerCsv(path, params, `${filename}-${todayStamp()}.csv`);
      toast.success("Arquivo CSV gerado.");
    } catch (error) {
      const friendly = friendlyError?.(error);
      if (friendly) toast.error(friendly);
      else notifyError(error, "Não foi possível exportar o CSV.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant={variant} disabled={disabled || pending} onClick={() => void run()}>
      <Download /> {pending ? "Gerando…" : label}
    </Button>
  );
}

/** Exporta no CLIENTE (dados já carregados por inteiro na tela, ex.: tabelas agregadas dos relatórios). */
export function ExportRowsButton({
  build,
  filename,
  label = "Exportar CSV",
  disabled,
  variant = "outline",
}: CommonProps & { build: () => { headers: readonly string[]; rows: readonly (readonly CsvValue[])[] } }) {
  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled}
      onClick={() => {
        const { headers, rows } = build();
        saveCsv(`${filename}-${todayStamp()}.csv`, buildCsv(headers, rows));
      }}
    >
      <Download /> {label}
    </Button>
  );
}
