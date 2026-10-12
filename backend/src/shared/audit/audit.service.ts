import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { currentAuditContext } from './audit-context';

export interface AuditRecordInput {
  /** Grupo afetado. Omitido = grupo do usuario da requisicao (token); acoes da plataforma sobre um grupo informam o grupo alvo. */
  organizationId?: number | null;
  /** Autor. Omitido = usuario autenticado da requisicao (login/falha de login informam explicitamente). */
  userId?: number | null;
  /** Codigo da acao (ver audit-actions.ts). */
  action: string;
  /** Entidade afetada (coluna `resource`). */
  entity: string;
  /** Id da entidade (numero ou texto); gravado como texto. */
  entityId?: string | number | null;
  /** Detalhes NAO sensiveis (ids, nomes de campos, contagens). Chaves de senha/token/hash sao removidas por seguranca. */
  meta?: Record<string, unknown>;
  /** IP do cliente. Omitido = IP da requisicao em curso. */
  ip?: string | null;
}

/** Chaves que NUNCA vao para o log, em qualquer nivel do `meta` (defesa em profundidade: o chamador ja nao deve passa-las). */
const SENSITIVE_KEY = /password|passwd|senha|token|hash|secret|authorization|cookie|jwt/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;

/** Copia o valor removendo chaves sensiveis, limitando profundidade e tamanho de texto. */
export function sanitizeAuditMeta(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeAuditMeta(v, depth + 1) ?? null) as Prisma.InputJsonArray;
  }
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = sanitizeAuditMeta(v, depth + 1);
    }
    return out as Prisma.InputJsonObject;
  }
  return null;
}

/**
 * Trilha de auditoria (SSOT): TODAS as gravacoes no AuditLog das acoes sensiveis passam por aqui. Nunca lanca:
 * falha de auditoria nao pode derrubar a acao de negocio ja concluida; vira log de erro. Quem chama NAO precisa
 * (e nao deve) tratar excecao nem repassar IP/usuario: sao lidos da requisicao em curso (audit-context.ts).
 *
 * Nunca registrar senha, token ou hash: o `meta` e' filtrado (sanitizeAuditMeta) e as chamadas passam so ids/campos.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      const ctx = currentAuditContext();
      const organizationId =
        input.organizationId !== undefined ? input.organizationId : (ctx.user?.organizationId ?? null);
      const userId = input.userId !== undefined ? input.userId : (ctx.user?.id ?? null);
      const meta = input.meta ? sanitizeAuditMeta(input.meta) : null;
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          userId,
          action: input.action,
          resource: input.entity,
          resourceId: input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
          metadata: meta === null ? Prisma.JsonNull : meta,
          ipAddress: input.ip !== undefined ? input.ip : (ctx.ip ?? null),
        },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao gravar auditoria (${input.action}/${input.entity}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
