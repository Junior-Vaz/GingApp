import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { UPLOAD_FILENAME_REGEX, uploadFilenameOf } from './image-ref';
import { UploadReferenceScanner } from './upload-reference-scanner';
import { resolveUploadsDir } from './uploads-dir';

export interface UploadReapResult {
  /** Arquivos distintos considerados (referencias validas de `/api/uploads`). */
  considered: number;
  /** Ainda citados por alguma coluna: mantidos. */
  kept: number;
  /** Arquivos apagados do disco (ou que ja nao existiam) e cuja linha Upload foi removida. */
  deleted: number;
  /** Falhas (disco/banco): o GC semanal recolhe o que sobrar. */
  failed: number;
}

/** Nomes de arquivo (`<uuid>.<ext>`) de uma lista de valores de coluna de imagem (caminho `/api/uploads/...` ou URL absoluta). */
export function uploadFilenamesOf(values: Iterable<unknown>): Set<string> {
  const names = new Set<string>();
  for (const value of values) {
    const name = uploadFilenameOf(value);
    if (name) names.add(name);
  }
  return names;
}

/**
 * LGPD: apaga do disco (e a linha `Upload`) as imagens de `/api/uploads` que uma anonimizacao acabou de soltar e que
 * NENHUMA outra coluna do banco referencia mais (foto compartilhada por duas entidades so some quando a ultima referencia
 * cai). Chamar DEPOIS do commit. NUNCA lanca: falha vira log e o GC semanal (`UploadsGcCronService`) recolhe o resto.
 * O nome precisa casar `UPLOAD_FILENAME_REGEX` (path traversal impossivel); arquivo ausente (ENOENT) nao e erro.
 */
@Injectable()
export class UploadReaper {
  private readonly logger = new Logger(UploadReaper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: UploadReferenceScanner,
  ) {}

  async deleteUnreferenced(values: Iterable<unknown>): Promise<UploadReapResult> {
    const result: UploadReapResult = { considered: 0, kept: 0, deleted: 0, failed: 0 };
    let names: Set<string>;
    try {
      names = uploadFilenamesOf(values);
      result.considered = names.size;
      if (names.size === 0) return result;
    } catch (error) {
      this.logger.error('Falha ao ler as referências de imagem a apagar.', error instanceof Error ? error.stack : String(error));
      return result;
    }
    let referenced: Set<string>;
    try {
      referenced = await this.scanner.referencedAmong(names);
    } catch (error) {
      // Sem saber se ainda ha referencia, NAO apaga nada (o GC semanal decide depois).
      this.logger.error('Falha ao conferir as referências de imagem; nada foi apagado.', error instanceof Error ? error.stack : String(error));
      result.failed = names.size;
      return result;
    }
    const dir = resolveUploadsDir();
    for (const name of names) {
      if (referenced.has(name)) {
        result.kept += 1;
        continue;
      }
      if (!UPLOAD_FILENAME_REGEX.test(name)) continue; // defesa em profundidade (ja filtrado acima)
      try {
        await fs.unlink(path.join(dir, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await this.prisma.upload.deleteMany({ where: { filename: name } });
        result.deleted += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.warn(`Não foi possível apagar a imagem ${name} (o GC semanal tenta de novo): ${(error as Error).message}`);
      }
    }
    return result;
  }
}
