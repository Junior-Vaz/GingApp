import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOAD_FILENAME_REGEX } from './image-ref';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `/api/uploads/<uuid>.<ext>` em qualquer texto (caminho relativo ou dentro de uma URL absoluta/JSON). */
const UPLOAD_URL_IN_TEXT = new RegExp(`/api/uploads/(${UUID}\\.(?:webp|jpg|png))`, 'g');
/** Tabelas que apenas CITAM o arquivo (nao o usam): ignorar, senao nada seria considerado orfao. */
const IGNORED_MODELS = new Set(['Upload', 'AuditLog']);

/**
 * Detector de REFERENCIAS a imagens de `/api/uploads` (SSOT do GC semanal `UploadsGcCronService` e da anonimizacao LGPD):
 * varre TODA coluna String/Json de TODA tabela do schema do Prisma (derivado de `Prisma.dmmf`, entao campos de imagem
 * futuros entram sozinhos), inclusive campos Json, atras de `/api/uploads/<arquivo>`.
 */
@Injectable()
export class UploadReferenceScanner {
  constructor(private readonly prisma: PrismaService) {}

  /** (tabela, coluna) candidatas a guardar uma referencia. Identificadores vem do schema (confiavel). */
  private columns(): Array<{ table: string; column: string }> {
    const out: Array<{ table: string; column: string }> = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      if (IGNORED_MODELS.has(model.name)) continue;
      const table = model.dbName ?? model.name;
      for (const field of model.fields) {
        if (field.kind !== 'scalar' || (field.type !== 'String' && field.type !== 'Json')) continue;
        out.push({ table, column: field.dbName ?? field.name });
      }
    }
    return out;
  }

  /** Nomes de arquivo citados (`/api/uploads/<uuid>.<ext>`) em qualquer coluna String/Json de qualquer tabela. */
  async referencedFilenames(): Promise<Set<string>> {
    const found = new Set<string>();
    for (const { table, column } of this.columns()) {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ v: string }>>(
        `SELECT "${column}"::text AS v FROM "${table}" WHERE "${column}"::text LIKE '%/api/uploads/%'`,
      );
      for (const row of rows) {
        for (const match of row.v.matchAll(UPLOAD_URL_IN_TEXT)) found.add(match[1]);
      }
    }
    return found;
  }

  /**
   * Dos `candidates` (nomes `<uuid>.<ext>`; nomes fora do formato sao ignorados), quais AINDA estao citados em alguma
   * coluna. Varredura direcionada (um LIKE ANY por coluna), bem mais barata que `referencedFilenames()` quando ha poucos
   * arquivos a conferir. Consulta o banco no momento da chamada (use DEPOIS do commit que soltou as referencias).
   */
  async referencedAmong(candidates: Iterable<string>): Promise<Set<string>> {
    const wanted = new Set<string>();
    for (const name of candidates) if (typeof name === 'string' && UPLOAD_FILENAME_REGEX.test(name)) wanted.add(name);
    const found = new Set<string>();
    if (wanted.size === 0) return found;
    // uuid + extensao: sem curinga de LIKE; o nome so entra como PARAMETRO, nunca concatenado no SQL.
    const patterns = [...wanted].map((name) => `%/api/uploads/${name}%`);
    for (const { table, column } of this.columns()) {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ v: string }>>(
        `SELECT "${column}"::text AS v FROM "${table}" WHERE "${column}"::text LIKE ANY ($1::text[])`,
        patterns,
      );
      for (const row of rows) {
        for (const match of row.v.matchAll(UPLOAD_URL_IN_TEXT)) if (wanted.has(match[1])) found.add(match[1]);
      }
      if (found.size === wanted.size) break;
    }
    return found;
  }
}
