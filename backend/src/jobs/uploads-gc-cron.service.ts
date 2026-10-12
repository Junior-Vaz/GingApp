import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../shared/prisma/prisma.service';
import { UPLOAD_FILENAME_REGEX } from '../shared/uploads/image-ref';
import { resolveUploadsDir } from '../shared/uploads/uploads-dir';

/** Todo domingo as 05:00, fuso de Sao Paulo. */
export const UPLOADS_GC_CRON_EXPRESSION = '0 5 * * 0';
export const UPLOADS_GC_CRON_TIMEZONE = 'America/Sao_Paulo';
export const UPLOADS_GC_CRON_NAME = 'uploads-gc-weekly';
/** Imagem so' e' candidata a limpeza depois deste tempo (quem acabou de enviar ainda esta preenchendo o formulario). */
export const UPLOADS_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** UPLOADS_GC=false desliga; UPLOADS_GC=dry-run so' registra no log o que apagaria. Padrao: ligado. */
export function uploadsGcMode(env: NodeJS.ProcessEnv = process.env): 'on' | 'off' | 'dry-run' {
  const v = env.UPLOADS_GC?.trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off') return 'off';
  if (v === 'dry-run' || v === 'dry') return 'dry-run';
  return 'on';
}

export interface UploadsGcResult {
  dryRun: boolean;
  /** Imagens distintas referenciadas por algum campo do banco. */
  referenced: number;
  filesRemoved: number;
  rowsRemoved: number;
  bytesFreed: number;
}

const UPLOAD_URL_IN_TEXT = /\/api\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|jpg|png))/g;
/** Tabelas que apenas CITAM o arquivo (nao o usam): ignorar, senao nada seria considerado orfao. */
const IGNORED_MODELS = new Set(['Upload', 'AuditLog']);

/**
 * Coleta de lixo das imagens enviadas por POST /uploads. Quando uma foto/logo/capa e' trocada ou removida, o arquivo
 * antigo continua em UPLOADS_DIR e na tabela Upload (e conta na cota do grupo). Semanalmente remove o que NAO esta
 * referenciado por NENHUM campo de texto/JSON de NENHUMA tabela (lista derivada do schema do Prisma, entao campos de
 * imagem futuros entram sozinhos) E tem mais de 24 h. Cobre tambem arquivos sem linha Upload (so' o mtime vale).
 */
@Injectable()
export class UploadsGcCronService {
  private readonly logger = new Logger(UploadsGcCronService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(UPLOADS_GC_CRON_EXPRESSION, { name: UPLOADS_GC_CRON_NAME, timeZone: UPLOADS_GC_CRON_TIMEZONE })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /**
   * Corpo do job (chamavel direto). `dir`, `now` e `organizationId` existem para o teste (diretorio temporario,
   * relogio e limitar a varredura das LINHAS Upload a um grupo; a producao nao os passa).
   */
  async run(options: { dir?: string; now?: Date; organizationId?: number } = {}): Promise<UploadsGcResult | null> {
    const mode = uploadsGcMode();
    if (mode === 'off') return null;
    if (this.running) return null;
    this.running = true;
    try {
      return await this.collect(
        options.dir ?? resolveUploadsDir(),
        options.now ?? new Date(),
        mode === 'dry-run',
        options.organizationId,
      );
    } catch (error) {
      this.logger.error('Falha na limpeza de imagens órfãs.', error instanceof Error ? error.stack : String(error));
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Nomes de arquivo citados (`/api/uploads/<uuid>.<ext>`) em qualquer coluna String/Json de qualquer tabela. */
  async referencedFilenames(): Promise<Set<string>> {
    const found = new Set<string>();
    for (const model of Prisma.dmmf.datamodel.models) {
      if (IGNORED_MODELS.has(model.name)) continue;
      const table = model.dbName ?? model.name;
      for (const field of model.fields) {
        if (field.kind !== 'scalar' || (field.type !== 'String' && field.type !== 'Json')) continue;
        const column = field.dbName ?? field.name;
        // Identificadores vem do schema (confiavel), nunca de entrada de usuario.
        const rows = await this.prisma.$queryRawUnsafe<Array<{ v: string }>>(
          `SELECT "${column}"::text AS v FROM "${table}" WHERE "${column}"::text LIKE '%/api/uploads/%'`,
        );
        for (const row of rows) {
          for (const match of row.v.matchAll(UPLOAD_URL_IN_TEXT)) found.add(match[1]);
        }
      }
    }
    return found;
  }

  private async collect(dir: string, now: Date, dryRun: boolean, organizationId?: number): Promise<UploadsGcResult> {
    const cutoff = new Date(now.getTime() - UPLOADS_GC_MIN_AGE_MS);
    const referenced = await this.referencedFilenames();
    const result: UploadsGcResult = { dryRun, referenced: referenced.size, filesRemoved: 0, rowsRemoved: 0, bytesFreed: 0 };

    // 1) Linhas Upload orfas e antigas (o arquivo vai junto, se existir).
    const rows = await this.prisma.upload.findMany({
      where: organizationId !== undefined ? { organizationId } : undefined,
      select: { filename: true, createdAt: true, sizeBytes: true },
    });
    const known = new Set(rows.map((r) => r.filename));
    for (const row of rows) {
      if (referenced.has(row.filename) || row.createdAt >= cutoff) continue;
      const full = path.join(dir, row.filename);
      if (dryRun) {
        if (await fs.stat(full).then(() => true, () => false)) result.filesRemoved += 1;
      } else {
        if (await this.unlinkIfExists(full)) result.filesRemoved += 1;
        await this.prisma.upload.deleteMany({ where: { filename: row.filename } });
      }
      result.rowsRemoved += 1;
      result.bytesFreed += row.sizeBytes;
    }

    // 2) Arquivos soltos no diretorio (sem linha Upload): so' pelo mtime. Nomes fora do padrao uuid sao ignorados.
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      names = []; // diretorio ainda nao existe: nada a limpar
    }
    for (const name of names) {
      if (!UPLOAD_FILENAME_REGEX.test(name) || referenced.has(name) || known.has(name)) continue;
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isFile() || stat.mtime >= cutoff) continue;
      if (!dryRun) await this.unlinkIfExists(full);
      result.filesRemoved += 1;
      result.bytesFreed += stat.size;
    }

    this.logger.log(
      `Imagens órfãs${dryRun ? ' (dry-run, nada apagado)' : ''}: ${result.filesRemoved} arquivo(s), ` +
        `${result.rowsRemoved} registro(s), ${result.bytesFreed} bytes; ${result.referenced} imagem(ns) em uso.`,
    );
    return result;
  }

  private async unlinkIfExists(full: string): Promise<boolean> {
    try {
      await fs.unlink(full);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
