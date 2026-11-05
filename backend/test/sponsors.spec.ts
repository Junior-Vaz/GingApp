import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMinorByBirthDate } from '../src/interface/http/feed/feed-minor';
import {
  clickRedirectUrl,
  ctrPercent,
  effectiveStatus,
  isEligibleNow,
  isIsoDay,
  looksLikeBot,
  looksLikeHtml,
  matchesRegion,
  normalizeStates,
  pickWeighted,
  sponsorsEnabled,
  toUf,
  validateDestinationUrl,
  windowError,
} from '../src/interface/http/sponsors/sponsor-rules';
import { appHomeUrl } from '../src/interface/http/sponsors/sponsors.service';
import { platformUploadMaxBytes } from '../src/interface/http/uploads/uploads.service';
import { buildRequestLogLine } from '../src/shared/observability/request-log.middleware';

/** Regras PURAS dos patrocinadores (docs/CONTRATO_PATROCINADORES.md). O comportamento HTTP esta em sponsors.e2e-spec.ts. */
describe('Patrocinadores: validação da URL de destino (contrato 2.6)', () => {
  const ok = (raw: string) => {
    const r = validateDestinationUrl(raw);
    assert.ok(r.ok, `${raw} deveria passar: ${JSON.stringify(r)}`);
    return r as { ok: true; url: string; host: string };
  };
  const bad = (raw: unknown, pattern?: RegExp) => {
    const r = validateDestinationUrl(raw);
    assert.equal(r.ok, false, `${String(raw).slice(0, 80)} deveria ser recusada`);
    const message = (r as { message: string }).message;
    assert.match(message, /^destinationUrl: /, 'a mensagem cita o campo');
    if (pattern) assert.match(message, pattern, message);
    return message;
  };

  it('aceita https com host público e NORMALIZA (host minúsculo, porta 443 removida, "/" no caminho vazio)', () => {
    assert.deepEqual(ok('https://www.Loja-Exemplo.com.br'), { ok: true, url: 'https://www.loja-exemplo.com.br/', host: 'www.loja-exemplo.com.br' });
    assert.equal(ok('  https://LOJA.com.br:443/Promo?x=1#topo  ').url, 'https://loja.com.br/Promo?x=1#topo');
    assert.equal(ok('HTTPS://loja.com.br/a b'.replace(' ', '%20')).url, 'https://loja.com.br/a%20b');
    assert.equal(ok('https://loja.com.br/caminho/ção').url, 'https://loja.com.br/caminho/%C3%A7%C3%A3o', 'acento no CAMINHO e codificado');
    assert.equal(ok('https://sub.dominio.loja.app/x').host, 'sub.dominio.loja.app');
  });

  it('recusa esquemas perigosos/inseguros: http, javascript:, data:, ftp, sem esquema, //host', () => {
    for (const raw of [
      'http://loja.com.br',
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'ftp://loja.com.br/arquivo',
      'loja.com.br',
      '//loja.com.br/x',
      'https:loja.com.br',
      'https:/loja.com.br',
      'vbscript:msgbox(1)',
    ]) {
      bad(raw, /https:\/\/|inválido/);
    }
  });

  it('recusa usuário/senha na URL (inclusive o truque do "@")', () => {
    bad('https://user:pass@loja.com.br/', /usuário ou senha/);
    bad('https://admin@loja.com.br/', /usuário ou senha/);
    bad('https://loja.com.br@evil.com/', /usuário ou senha/);
    bad('https://loja.com.br\\@evil.com/', /barra invertida/);
  });

  it('recusa IP em qualquer notação (v4 decimal/hex/curta e v6) e localhost', () => {
    for (const raw of [
      'https://127.0.0.1/',
      'https://10.0.0.5/admin',
      'https://192.168.0.1',
      'https://169.254.169.254/latest/meta-data/',
      'https://2130706433/',
      'https://0x7f.0.0.1/',
      'https://127.1/',
      'https://[::1]/',
      'https://[0:0:0:0:0:ffff:7f00:1]/',
      'https://[fe80::1]/',
    ]) {
      bad(raw, /IP/);
    }
    for (const raw of ['https://localhost/', 'https://LOCALHOST:443/', 'https://app.localhost/', 'https://intranet/']) {
      bad(raw, /público|inválido/);
    }
  });

  it('recusa rede interna/reservada (.local, .internal, .lan, .corp, .home.arpa...)', () => {
    for (const raw of [
      'https://impressora.local/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://nas.lan/',
      'https://servidor.corp/',
      'https://roteador.home.arpa/',
      'https://exemplo.test/',
      'https://site.onion/',
    ]) {
      bad(raw, /público/);
    }
  });

  it('recusa porta estranha (qualquer porta explícita além da 443 padrão)', () => {
    bad('https://loja.com.br:8443/', /porta/);
    bad('https://loja.com.br:22/', /porta/);
    bad('https://loja.com.br:65535/', /porta/);
  });

  it('recusa domínio unicode/punycode enganoso (homógrafo) e caracteres inválidos no host', () => {
    bad('https://аpple.com/', /acentos|internacionalizados/); // "а" cirílico
    bad('https://xn--pple-43d.com/', /internacionalizados/);
    bad('https://lojã.com.br/', /internacionalizados/);
    bad('https://loja_teste.com.br/', /não permitidos/);
    bad('https://loja.com.br./', /ponto/);
    bad('https://-loja.com.br/', /não permitidos/);
  });

  it('recusa espaço, controle, vazio, não-texto e URL gigante (> 500 antes ou depois de normalizar)', () => {
    bad('https://loja.com.br/a b', /espaços/);
    bad('https://loja.com.br/\u0000x', /controle/);
    bad('https://loja.com.br/​', /invisíveis/);
    bad('https://loja.com.br/‮gnp.exe', /invisíveis/);
    bad('', /informe/);
    bad('   ', /informe/);
    bad(undefined, /informe/);
    bad(42, /informe/);
    bad(`https://loja.com.br/${'a'.repeat(500)}`, /500/);
    // 480 caracteres crus que crescem acima de 500 ao codificar (ç -> %C3%A7)
    const grows = `https://loja.com.br/${'ç'.repeat(200)}`;
    assert.ok(grows.length <= 500);
    bad(grows, /500/);
    assert.ok(ok(`https://loja.com.br/${'a'.repeat(480)}`).url.length <= 500);
  });
});

describe('Patrocinadores: clique (utm) e interruptor', () => {
  it('acrescenta utm preservando a query e o fragmento existentes; não sobrescreve utm do patrocinador', () => {
    assert.equal(
      clickRedirectUrl('https://loja.com.br/', 7),
      'https://loja.com.br/?utm_source=gingapp&utm_medium=parceiro&utm_campaign=c7',
    );
    assert.equal(
      clickRedirectUrl('https://loja.com.br/p?cor=azul&q=a+b#ofertas', 12),
      'https://loja.com.br/p?cor=azul&q=a+b&utm_source=gingapp&utm_medium=parceiro&utm_campaign=c12#ofertas',
    );
    assert.equal(
      clickRedirectUrl('https://loja.com.br/?utm_source=insta&x=1', 3),
      'https://loja.com.br/?utm_source=insta&x=1&utm_medium=parceiro&utm_campaign=c3',
    );
  });

  it('SPONSORS_ENABLED: padrão ligado; só "false" desliga', () => {
    assert.equal(sponsorsEnabled({}), true);
    assert.equal(sponsorsEnabled({ SPONSORS_ENABLED: 'true' }), true);
    assert.equal(sponsorsEnabled({ SPONSORS_ENABLED: '0' }), true);
    assert.equal(sponsorsEnabled({ SPONSORS_ENABLED: 'off' }), true);
    assert.equal(sponsorsEnabled({ SPONSORS_ENABLED: 'false' }), false);
    assert.equal(sponsorsEnabled({ SPONSORS_ENABLED: ' FALSE ' }), false);
  });

  it('APP_URL: `<APP_URL>/` sem barra dupla; ausente = null (o clique responde 404)', () => {
    assert.equal(appHomeUrl({ APP_URL: 'https://app.gingapp.com.br' }), 'https://app.gingapp.com.br/');
    assert.equal(appHomeUrl({ APP_URL: 'https://app.gingapp.com.br//' }), 'https://app.gingapp.com.br/');
    assert.equal(appHomeUrl({}), null);
    assert.equal(appHomeUrl({ APP_URL: '  ' }), null);
  });
});

describe('Patrocinadores: UFs, janela, status efetivo, elegibilidade', () => {
  it('toUf: só as 27 siglas (qualquer caixa); o resto vira ""', () => {
    assert.equal(toUf('sp'), 'SP');
    assert.equal(toUf(' df '), 'DF');
    assert.equal(toUf('XX'), '');
    assert.equal(toUf('São Paulo'), '');
    assert.equal(toUf(undefined), '');
    assert.equal(toUf(['SP']), '');
  });

  it('normalizeStates: maiúsculas, sem repetidas, ordenada; inválida = erro citando o campo; vazia = Brasil todo', () => {
    assert.deepEqual(normalizeStates(['sp', 'GO', 'SP', 'df']), { ok: true, states: ['DF', 'GO', 'SP'] });
    assert.deepEqual(normalizeStates([]), { ok: true, states: [] });
    const r = normalizeStates(['GO', 'XX', 'Goiás']);
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /^states contém UF inválida: XX, Goiás/);
    assert.equal(normalizeStates('GO').ok, false);
    const all27 = normalizeStates(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
    assert.equal(all27.ok && all27.states.length, 27);
  });

  it('janela: fim > início e no máximo 366 dias', () => {
    const s = new Date('2026-01-01T03:00:00Z');
    assert.equal(windowError(s, new Date('2027-01-02T03:00:00Z')), null, '366 dias exatos');
    assert.match(windowError(s, new Date('2027-01-02T03:00:01Z')) ?? '', /366/);
    assert.match(windowError(s, s) ?? '', /^endsAt: /);
    assert.match(windowError(s, new Date('2025-12-31T00:00:00Z')) ?? '', /depois do início/);
    assert.match(windowError(new Date('x'), s) ?? '', /inválidas/);
  });

  it('effectiveStatus: ENDED vence; DRAFT/PAUSED; ACTIVE = SCHEDULED antes, ACTIVE_NOW em [início, fim)', () => {
    const startsAt = new Date('2026-11-10T03:00:00Z');
    const endsAt = new Date('2026-11-20T03:00:00Z');
    const at = (iso: string) => new Date(iso);
    const c = (status: string) => ({ status, startsAt, endsAt });
    assert.equal(effectiveStatus(c('ACTIVE'), at('2026-11-10T02:59:59Z')), 'SCHEDULED');
    assert.equal(effectiveStatus(c('ACTIVE'), startsAt), 'ACTIVE_NOW', 'início é inclusivo');
    assert.equal(effectiveStatus(c('ACTIVE'), at('2026-11-20T02:59:59Z')), 'ACTIVE_NOW');
    assert.equal(effectiveStatus(c('ACTIVE'), endsAt), 'ENDED', 'fim é exclusivo');
    assert.equal(effectiveStatus(c('DRAFT'), at('2026-11-15T00:00:00Z')), 'DRAFT');
    assert.equal(effectiveStatus(c('PAUSED'), at('2026-11-15T00:00:00Z')), 'PAUSED');
    assert.equal(effectiveStatus(c('PAUSED'), at('2026-12-01T00:00:00Z')), 'ENDED');
    assert.equal(effectiveStatus(c('DRAFT'), at('2026-12-01T00:00:00Z')), 'ENDED');
    assert.equal(isEligibleNow(c('ACTIVE'), at('2026-11-15T00:00:00Z')), true);
    assert.equal(isEligibleNow(c('PAUSED'), at('2026-11-15T00:00:00Z')), false);
    assert.equal(isEligibleNow(c('ACTIVE'), endsAt), false);
  });

  it('matchesRegion: lista vazia = Brasil todo; com lista só se a UF (conhecida) estiver nela', () => {
    assert.equal(matchesRegion([], ''), true);
    assert.equal(matchesRegion([], 'GO'), true);
    assert.equal(matchesRegion(['GO', 'SP'], 'SP'), true);
    assert.equal(matchesRegion(['GO', 'SP'], 'RJ'), false);
    assert.equal(matchesRegion(['GO'], ''), false, 'UF desconhecida só vê campanhas nacionais');
  });

  it('isIsoDay: só AAAA-MM-DD de calendário real', () => {
    assert.equal(isIsoDay('2026-11-04'), true);
    assert.equal(isIsoDay('2026-02-30'), false);
    assert.equal(isIsoDay('2026-1-4'), false);
    assert.equal(isIsoDay('2026-11-04T00:00:00Z'), false);
    assert.equal(isIsoDay(20261104), false);
  });
});

describe('Patrocinadores: sorteio ponderado, CTR, anti-robô, texto, menor, upload', () => {
  it('pickWeighted: determinístico com RNG injetado; respeita o peso; vazio = null', () => {
    const items = [
      { id: 1, weight: 1 },
      { id: 2, weight: 3 },
      { id: 3, weight: 6 },
    ]; // total 10: [0,1) -> 1, [1,4) -> 2, [4,10) -> 3
    const pick = (r: number) => pickWeighted(items, () => r)?.id;
    assert.equal(pick(0), 1);
    assert.equal(pick(0.0999), 1);
    assert.equal(pick(0.1), 2);
    assert.equal(pick(0.3999), 2);
    assert.equal(pick(0.4), 3);
    assert.equal(pick(0.999999), 3);
    assert.equal(pick(1), 3, 'rng fora da faixa é limitado');
    assert.equal(pick(-5), 1);
    assert.equal(pickWeighted([], () => 0.5), null);
    assert.equal(pickWeighted([{ id: 9, weight: 0 }, { id: 8, weight: Number.NaN }], () => 0.6)?.id, 8, 'peso inválido conta 1');
    // distribuição com uma sequência fixa (LCG): proporção perto de 1:3:6
    let seed = 42;
    const lcg = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    const counts = new Map<number, number>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = pickWeighted(items, lcg)!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    assert.ok(Math.abs((counts.get(1) ?? 0) - 1000) < 200, JSON.stringify([...counts]));
    assert.ok(Math.abs((counts.get(3) ?? 0) - 6000) < 300, JSON.stringify([...counts]));
  });

  it('ctrPercent: cliques/impressões em %, 2 casas; 0 sem impressões', () => {
    assert.equal(ctrPercent(0, 0), 0);
    assert.equal(ctrPercent(0, 5), 0);
    assert.equal(ctrPercent(3, 1), 33.33);
    assert.equal(ctrPercent(3, 2), 66.67);
    assert.equal(ctrPercent(200, 3), 1.5);
    assert.equal(ctrPercent(7, 7), 100);
  });

  it('looksLikeBot: UA ausente/curto/robô/ferramenta = robô; navegadores reais não', () => {
    for (const ua of [undefined, '', 'abc', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'curl/8.4.0', 'python-requests/2.31', 'Wget/1.21',
      'facebookexternalhit/1.1', 'WhatsApp/2.23.20.0', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      'axios/1.6.0', 'node-fetch/1.0', 'PostmanRuntime/7.36.0', 'okhttp/4.12.0', 'Java/17.0.2', 'Go-http-client/2.0']) {
      assert.equal(looksLikeBot(ua), true, String(ua));
    }
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    ]) {
      assert.equal(looksLikeBot(ua), false, ua);
    }
  });

  it('looksLikeHtml: tags/comentários/doctype; "<" comum de texto passa', () => {
    assert.equal(looksLikeHtml('<b>oferta</b>'), true);
    assert.equal(looksLikeHtml('Clique <a href=x>aqui</a>'), true);
    assert.equal(looksLikeHtml('<!-- x -->'), true);
    assert.equal(looksLikeHtml('< script>'), true);
    assert.equal(looksLikeHtml('</p>'), true);
    assert.equal(looksLikeHtml('preço < 10 reais'), false);
    assert.equal(looksLikeHtml('3<4 e 5>2'), false);
  });

  it('isMinorByBirthDate (regra do feed extraída): < 18 no dia de SP; sem data decide o chamador', () => {
    const now = new Date('2026-11-04T15:00:00Z');
    assert.equal(isMinorByBirthDate(new Date('2008-11-05T00:00:00Z'), false, now), true, '18 anos amanhã');
    assert.equal(isMinorByBirthDate(new Date('2008-11-04T00:00:00Z'), true, now), false, '18 hoje');
    assert.equal(isMinorByBirthDate(null, true, now), true);
    assert.equal(isMinorByBirthDate(undefined, false, now), false);
  });

  it('platformUploadMaxBytes: 250 KB padrão; PLATFORM_UPLOAD_MAX_KB numérico > 0 substitui', () => {
    assert.equal(platformUploadMaxBytes({}), 250 * 1024);
    assert.equal(platformUploadMaxBytes({ PLATFORM_UPLOAD_MAX_KB: '100' }), 100 * 1024);
    assert.equal(platformUploadMaxBytes({ PLATFORM_UPLOAD_MAX_KB: 'x' }), 250 * 1024);
    assert.equal(platformUploadMaxBytes({ PLATFORM_UPLOAD_MAX_KB: '0' }), 250 * 1024);
  });

  it('log de requisição: /api/sponsors/* sai SEM userId e SEM ip; outras rotas seguem iguais', () => {
    const req = (path: string) => ({ method: 'GET', ip: '203.0.113.9', baseUrl: '', route: { path }, user: { id: 77 } });
    const click = buildRequestLogLine(req('/api/sponsors/:id/click') as never, { statusCode: 302 } as never, 'rid-123456', 1);
    assert.equal(click.userId, null);
    assert.equal(click.ip, null);
    assert.equal(click.route, '/api/sponsors/:id/click');
    const imp = buildRequestLogLine(req('/api/sponsors/:id/impression') as never, { statusCode: 204 } as never, 'rid-123456', 1);
    assert.deepEqual([imp.userId, imp.ip], [null, null]);
    const other = buildRequestLogLine(req('/api/platform-sponsors') as never, { statusCode: 200 } as never, 'rid-123456', 1);
    assert.deepEqual([other.userId, other.ip], [77, '203.0.113.9']);
  });
});
