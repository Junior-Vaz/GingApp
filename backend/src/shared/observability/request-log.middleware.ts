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

/**
 * Rotas do app/clique dos patrocinadores (docs/CONTRATO_PATROCINADORES.md 2.1 e 4.2: "nunca loga nem guarda IP/UA do
 * clique"; nenhum identificador pessoal em log): a linha sai SEM userId e SEM ip. As de plataforma (/api/platform-...)
 * seguem normais. Idem a pagina publica de transparencia (docs/CONTRATO_TRANSPARENCIA.md regra 6: nenhum IP/User-Agent
 * guardado ao servir): GET /api/transparency. Idem o pedido PUBLICO de adesao de grupo (docs/CONTRATO_ADESAO_GRUPOS.md
 * regra 4: "nao guardar IP nem User-Agent"): POST /api/public/group-applications, GET .../:token e, da confirmacao do
 * e-mail (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 1), POST .../confirm (token do link no CORPO) e POST .../:token/resend. O
 * token de acompanhamento so aparece como o padrao `:token`, nunca o valor; o corpo (senha, token do link) nunca e logado
 * por este middleware.
 */
const ANONYMOUS_LOG_ROUTE = /^\/api\/(sponsors\/|transparency$|public\/group-applications(\/|$))/;

export function buildRequestLogLine(req: Request, res: Response, requestId: string, ms: number): RequestLogLine {
  const status = res.statusCode;
  const route = routePattern(req);
  const anonymous = ANONYMOUS_LOG_ROUTE.test(route);
  return {
    ts: new Date().toISOString(),
    level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
    msg: 'http_request',
    requestId,
    method: req.method,
    route,
    status,
    ms: Math.round(ms * 10) / 10,
    userId: anonymous ? null : ((req as Request & { user?: { id?: number } }).user?.id ?? null),
    ip: anonymous ? null : (req.ip ?? null),
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
