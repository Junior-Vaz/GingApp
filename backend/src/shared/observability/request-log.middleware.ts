import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Cabecalho de correlacao: devolvido em TODA resposta e, se REQUEST_LOG=true, presente no log da requisicao. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Aceita o id enviado por um proxy/cliente so se for curto e inofensivo (evita injecao de log por cabecalho). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** REQUEST_LOG=true liga o log estruturado de requisicao (padrao: desligado; os testes tambem). Lido a cada requisicao. */
export function isRequestLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REQUEST_LOG?.trim().toLowerCase() === 'true';
}

/** Rotas que nao valem o ruido (health check de orquestrador a cada poucos segundos). */
const SKIPPED_ROUTES = new Set(['/api/health']);

export interface RequestLogLine {
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: 'http_request';
  requestId: string;
  method: string;
  /** Padrao da rota (ex.: /api/students/:id), NUNCA a URL real: ids, codigos e querystring (tokens) ficam fora do log. */
  route: string;
  status: number;
  ms: number;
  userId: number | null;
  ip: string | null;
}

/** Padrao da rota que casou; 'unmatched' (404) para nao gravar URLs arbitrarias enviadas por um atacante. */
function routePattern(req: Request): string {
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  return typeof pattern === 'string' ? `${req.baseUrl ?? ''}${pattern}` : 'unmatched';
}

export function buildRequestLogLine(req: Request, res: Response, requestId: string, ms: number): RequestLogLine {
  const status = res.statusCode;
  return {
    ts: new Date().toISOString(),
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    msg: 'http_request',
    requestId,
    method: req.method,
    route: routePattern(req),
    status,
    ms: Math.round(ms * 10) / 10,
    userId: (req as Request & { user?: { id?: number } }).user?.id ?? null,
    ip: req.ip ?? null,
  };
}

/**
 * Middleware de observabilidade minima: gera/propaga o X-Request-Id e, com REQUEST_LOG=true, escreve UMA linha JSON por
 * requisicao ao terminar (metodo, rota, status, ms, requestId). Nunca registra corpo, querystring, cabecalhos
 * (Authorization/Cookie) nem parametros reais da URL.
 */
export function requestLogMiddleware(sink: (line: string) => void = (line) => process.stdout.write(line)) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    if (isRequestLogEnabled()) {
      const started = process.hrtime.bigint();
      res.once('finish', () => {
        const line = buildRequestLogLine(req, res, requestId, Number(process.hrtime.bigint() - started) / 1e6);
        if (SKIPPED_ROUTES.has(line.route)) return;
        sink(`${JSON.stringify(line)}\n`);
      });
    }
    next();
  };
}
