import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Contexto da requisicao HTTP em curso, para o AuditService preencher sozinho o que os services nao recebem:
 * IP do cliente e usuario autenticado (req.user so e' populado DEPOIS do JwtAuthGuard, por isso guardamos a
 * propria requisicao e lemos `req.user` na hora de gravar, nao na hora de abrir o contexto).
 */
interface AuditRequestContext {
  req: Pick<Request, 'ip'> & { user?: AuthenticatedUser };
}

const storage = new AsyncLocalStorage<AuditRequestContext>();

/** Middleware Express (registrado em AppModule.configure): abre o contexto para toda a cadeia da requisicao. */
export function auditContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ req: req as AuditRequestContext['req'] }, next);
}

/** IP e usuario da requisicao atual (vazios fora de uma requisicao HTTP: jobs, scripts, testes unitarios). */
export function currentAuditContext(): { ip?: string; user?: AuthenticatedUser } {
  const ctx = storage.getStore();
  if (!ctx) return {};
  return { ip: ctx.req.ip, user: ctx.req.user };
}
