import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { saveCsv } from "@/lib/csv";
import {
  buildTemplateCsv,
  IMPORT_CODE_LABEL,
  IMPORT_MAX_BYTES,
  parseStudentsCsv,
  type ImportAction,
  type ImportResult,
  type ImportRow,
} from "./students-import";

const ACTION_LABEL: Record<ImportAction, string> = {
  CREATE: "Será criado",
  IGNORE: "Já existe (ignorado)",
  ERROR: "Erro",
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsText(file, "utf-8");
  });
}

/**
 * Importação de alunos por CSV (só o Mestre). Fluxo: baixar o modelo -> escolher o arquivo -> o painel lê o CSV e envia
 * as linhas com `dryRun` (o servidor valida e devolve erro por linha, sem gravar) -> pré-visualização -> confirmar
 * (mesma chamada sem `dryRun`). Reenviar o mesmo arquivo não duplica ninguém (o servidor ignora quem já existe).
 */
export function ImportarAlunosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  // "Importar mesmo assim os possíveis duplicados": reenvia com confirmNew:true (simulação e gravação).
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const duplicatesId = useId();

  const preview = useMutation({
    mutationFn: ({ payload, confirmNew }: { payload: ImportRow[]; confirmNew: boolean }) =>
      api.post<ImportResult>("/students/import", { rows: payload, dryRun: true, ...(confirmNew ? { confirmNew: true } : {}) }),
    onSuccess: (data, { confirmNew }) => {
      // a contagem vem da simulação SEM confirmação (com ela, as linhas deixam de ser duplicados pendentes)
      if (!confirmNew) setDuplicateCount(data.items.filter((item) => item.code === "POSSIBLE_DUPLICATE").length);
    },
  });
  const confirm = useMutation({
    mutationFn: (payload: ImportRow[]) =>
      api.post<ImportResult>("/students/import", { rows: payload, dryRun: false, ...(includeDuplicates ? { confirmNew: true } : {}) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["crud", "/students"] });
      const extra = [
        result.ignored ? `${result.ignored} já existiam` : "",
        result.failed ? `${result.failed} com erro` : "",
      ].filter(Boolean);
      toast.success(`${result.created} aluno(s) importado(s)${extra.length ? ` (${extra.join(", ")})` : ""}.`);
      onOpenChange(false);
    },
    onError: (error) => notifyError(error, "Não foi possível importar os alunos."),
  });

  useEffect(() => {
    if (!open) return;
    setFileName("");
    setRows([]);
    setNotes([]);
    setFileError(null);
    setIncludeDuplicates(false);
    setDuplicateCount(0);
    preview.reset();
    confirm.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reinicia ao abrir
  }, [open]);

  async function onFile(file: File | undefined) {
    preview.reset();
    setRows([]);
    setNotes([]);
    setFileError(null);
    setIncludeDuplicates(false);
    setDuplicateCount(0);
    if (!file) {
      setFileName("");
      return;
    }
    setFileName(file.name);
    if (file.size > IMPORT_MAX_BYTES) {
      setFileError("O arquivo é grande demais (máximo 1 MB). Divida em arquivos menores.");
      return;
    }
    try {
      const parsed = parseStudentsCsv(await readFile(file));
      if (parsed.error) {
        setFileError(parsed.error);
        return;
      }
      setRows(parsed.rows);
      setNotes(parsed.ignoredColumns.length ? [`Colunas ignoradas: ${parsed.ignoredColumns.join(", ")}.`] : []);
      preview.mutate({ payload: parsed.rows, confirmNew: false });
    } catch (error) {
      setFileError(errorMessage(error, "Não foi possível ler o arquivo."));
    }
  }

  const result = preview.data;
  function toggleDuplicates(checked: boolean) {
    setIncludeDuplicates(checked);
    preview.mutate({ payload: rows, confirmNew: checked });
  }
  const busy = preview.isPending || confirm.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar alunos</DialogTitle>
          <DialogDescription>
            Envie uma planilha CSV (máximo de 500 linhas). Antes de gravar, mostramos o que será criado e o que tem erro.
            Quem já está cadastrado (mesmo e-mail, ou mesmo nome e nascimento) é ignorado. Se a pessoa já tem ficha no GingApp (CPF ou código), mostramos o motivo na linha.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => saveCsv("modelo-importacao-alunos.csv", buildTemplateCsv())}>
              <FileDown /> Baixar modelo CSV
            </Button>
            <span className="text-xs text-muted-foreground">
              Colunas: Nome (obrigatório), Data de nascimento, E-mail, Telefone, CPF, Unidade, Situação, Data de ingresso, CPF do responsável, Código GingApp.
            </span>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              Arquivo CSV
            </label>
            <Input
              id={inputId}
              type="file"
              accept=".csv,text/csv"
              disabled={confirm.isPending}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {fileName && !fileError && rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {fileName}: {rows.length} linha(s) lida(s).
              </p>
            )}
          </div>

          {fileError && (
            <p role="alert" data-testid="import-file-error" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
          {notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
          {preview.isPending && <p className="text-sm text-muted-foreground">Validando as linhas…</p>}
          {preview.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(preview.error, "Não foi possível validar o arquivo.")}
            </p>
          )}

          {result && (
            <div className="grid gap-3" data-testid="import-preview">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge data-testid="import-created">{result.created} a criar</Badge>
                <Badge variant="secondary" data-testid="import-ignored">
                  {result.ignored} já existem
                </Badge>
                <Badge variant={result.failed ? "destructive" : "outline"} data-testid="import-failed">
                  {result.failed} com erro
                </Badge>
              </div>
              {result.plan && (
                <p className="text-xs text-muted-foreground">
                  Plano "{result.plan.planName}": {result.plan.activeStudents} de {result.plan.maxStudents} alunos ativos
                  ({result.plan.availableSlots} vaga(s) livre(s)).
                </p>
              )}
              {result.failed > 0 && (
                <p className="text-xs text-muted-foreground">As linhas com erro não serão importadas. Corrija a planilha e envie de novo, se quiser.</p>
              )}
              {(duplicateCount > 0 || includeDuplicates) && (
                <div className="flex items-start gap-2 rounded-md border p-3" data-testid="import-duplicates">
                  <Checkbox
                    id={duplicatesId}
                    checked={includeDuplicates}
                    disabled={busy}
                    onCheckedChange={(checked) => toggleDuplicates(checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor={duplicatesId} className="text-sm">
                    Importar mesmo assim os possíveis duplicados ({duplicateCount})
                    <span className="block text-xs text-muted-foreground">
                      Marque só se você conferiu que NÃO são as mesmas pessoas já cadastradas no GingApp.
                    </span>
                  </label>
                </div>
              )}
              <div className="max-h-72 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Linha</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="w-44">Resultado</TableHead>
                      <TableHead>Detalhe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.items.map((item) => (
                      <TableRow key={item.line} data-testid={`import-row-${item.line}`}>
                        <TableCell>{item.line}</TableCell>
                        <TableCell className="font-medium">{item.name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={item.action === "ERROR" ? "destructive" : item.action === "IGNORE" ? "secondary" : "default"}>
                            {ACTION_LABEL[item.action]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.code && (
                            <span data-testid={`import-code-${item.line}`} className="mr-1 font-medium text-foreground">
                              {IMPORT_CODE_LABEL[item.code] ?? item.code}.
                            </span>
                          )}
                          {item.messages.join(" ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={confirm.isPending}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy || !result || result.created === 0} onClick={() => confirm.mutate(rows)}>
            {confirm.isPending ? "Importando…" : `Importar ${result?.created ?? 0} aluno(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
