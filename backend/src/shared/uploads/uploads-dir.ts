import * as path from 'node:path';

/** Diretorio de armazenamento das imagens (UPLOADS_DIR; padrao ./uploads). Lido a cada chamada: os testes trocam a env. */
export function resolveUploadsDir(): string {
  return path.resolve(process.env.UPLOADS_DIR?.trim() || './uploads');
}
