import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emailDedupKey, normalizeBrPhone, normalizeDate, validateAnswers } from '../src/interface/http/registration-forms/answer-validation';
import {
  clientIpKey,
  generateProtocol,
  generateSlug,
  hashIp,
  issueStartedToken,
  normalizeProtocol,
  PROTOCOL_REGEX,
  SLUG_REGEX,
  verifyStartedToken,
} from '../src/interface/http/registration-forms/form-codes';
import { closedReasonOf, effectiveConsentText, safeBannerUrl, waitlistCap } from '../src/interface/http/registration-forms/form-common';
import { defaultConsentText, FIELD_KEY_REGEX, validateFields } from '../src/interface/http/registration-forms/form-definition';
import { FORM_TEMPLATES, TEMPLATE_KEYS } from '../src/interface/http/registration-forms/form-templates';
import { detectPrivateFileType, formsFileMaxBytes, privateFilePath, sanitizeOriginalName } from '../src/interface/http/registration-forms/private-storage';
import { plainExcerpt, renderShareHtml } from '../src/interface/http/registration-forms/share-html';
import { formsRetentionModeLabel, retentionCutoffForUndated, retentionReference } from '../src/interface/http/registration-forms/submission-purge';
import { renderRegistrationNoticeMail } from '../src/shared/mail/mail-templates';

/** Regras puras dos formularios de inscricao (F1): rapidas, sem banco. */
describe('Formulários de inscrição — regras puras', () => {
  it('protocolo INS-XXXXXX sem caracteres ambíguos; slug só [a-z0-9-] com sufixo', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateProtocol();
      assert.match(p, PROTOCOL_REGEX);
      assert.ok(!/[01OIL]/.test(p.slice(4)), p);
    }
    assert.equal(normalizeProtocol(' ins-7k3q9x '), 'INS-7K3Q9X');
    assert.equal(normalizeProtocol('INS-7K3Q90'), null); // "0" e ambiguo
    const slug = generateSlug('1º Campeonato de Capoeira no Varjão (DF)!');
    assert.match(slug, /^1-campeonato-de-capoeira-no-varjao-df-[a-z2-9]{5}$/);
    assert.ok(SLUG_REGEX.test(slug));
    assert.ok(SLUG_REGEX.test(generateSlug('!!!')));
  });

  it('magic bytes: JPEG/PNG/WEBP/PDF aceitos; SVG/HTML/GIF recusados; caminho privado sem traversal', () => {
    const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
    assert.equal(detectPrivateFileType(pad([0xff, 0xd8, 0xff, 0xe0]))?.ext, 'jpg');
    assert.equal(detectPrivateFileType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.ext, 'png');
    assert.equal(detectPrivateFileType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary'))?.ext, 'webp');
    assert.equal(detectPrivateFileType(Buffer.from('%PDF-1.7\n%âãÏÓ\n'))?.ext, 'pdf');
    assert.equal(detectPrivateFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(detectPrivateFileType(Buffer.from('<!doctype html><html></html>')), null);
    assert.equal(detectPrivateFileType(Buffer.from('GIF89a................')), null);
    assert.equal(privateFilePath('org-1/../../etc/passwd', '/base'), null);
    assert.equal(privateFilePath('org-1/00000000-0000-4000-8000-000000000000.svg', '/base'), null);
    assert.ok(privateFilePath('org-1/00000000-0000-4000-8000-000000000000.pdf', '/base'));
    assert.equal(sanitizeOriginalName('../../x/<b>pix.jpg', 'jpg'), '_b_pix.jpg');
    assert.equal(sanitizeOriginalName('C:\\Users\\a\\comprovante "pix"', 'pdf'), 'comprovante _pix_.pdf');
    assert.equal(sanitizeOriginalName('', 'pdf'), 'arquivo.pdf');
  });

  it('respostas: telefone BR, data civil, opções, showIf em cadeia', () => {
    assert.equal(normalizeBrPhone('+55 (61) 99876-5432'), '61998765432');
    assert.equal(normalizeBrPhone('6133334444'), '6133334444');
    assert.equal(normalizeBrPhone('12345'), null);
    assert.equal(normalizeDate('2024-02-29'), '2024-02-29');
    assert.equal(normalizeDate('2023-02-29'), null);
    const fields = [
      { key: 'a', type: 'SINGLE_CHOICE', required: true, options: ['Sim', 'Não'], validation: null, showIf: null },
      { key: 'b', type: 'MULTI_CHOICE', required: true, options: ['x', 'y'], validation: null, showIf: { fieldKey: 'a', equals: 'Sim' } },
      { key: 'c', type: 'SHORT_TEXT', required: true, options: null, validation: null, showIf: { fieldKey: 'b', equals: 'y' } },
    ];
    // a=Não: b e c ocultos (nao exigidos, respostas descartadas)
    let r = validateAnswers(fields, { a: 'Não', b: ['z'], c: 'texto' });
    assert.deepEqual(r.errors, {});
    assert.deepEqual(r.values, { a: 'Não' });
    // a=Sim, b sem "y": c oculto
    r = validateAnswers(fields, { a: 'Sim', b: ['x'] });
    assert.deepEqual(r.errors, {});
    // a=Sim, b com "y": c exigido
    r = validateAnswers(fields, { a: 'Sim', b: ['y'] });
    assert.deepEqual(Object.keys(r.errors), ['c']);
    // b invalido (opcao fora da lista): erro em b e c fica oculto ate b ser corrigido
    r = validateAnswers(fields, { a: 'Sim', b: ['y', 'z'] });
    assert.deepEqual(Object.keys(r.errors), ['b']);
  });

  it('definição: showIf só para trás; limites de opções; INFO nunca obrigatório', () => {
    const ok = validateFields([
      { key: 'info', type: 'INFO', label: 'Leia', required: true },
      { key: 'q', type: 'SELECT', label: 'Q', options: ['a', 'b'] },
      { key: 'r', type: 'SHORT_TEXT', label: 'R', showIf: { fieldKey: 'q', equals: 'a' } },
    ]);
    assert.deepEqual(ok.errors, {});
    assert.equal(ok.fields[0].required, false);
    const bad = validateFields([{ key: 'q', type: 'SELECT', label: 'Q', options: Array.from({ length: 41 }, (_, i) => `o${i}`) }]);
    assert.ok(bad.errors.q);
    assert.ok(validateFields([{ key: '1abc', type: 'SHORT_TEXT', label: 'x' }]).errors['fields[0]']);
  });

  it('share: tudo escapado, script só com o redirect em JSON; resumo sem marcação; data de encerramento = a mais tardia', () => {
    const { html, scriptHash } = renderShareHtml({
      title: '</title><script>alert(1)</script>',
      description: '" onload="x',
      imageUrl: 'https://x.test/a.png?a=1&b=2',
      url: 'https://app.test/i/abc',
      redirectUrl: 'https://app.test/i/abc?src=share',
    });
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&quot; onload=&quot;x'));
    assert.ok(html.includes('a=1&amp;b=2'));
    assert.match(scriptHash ?? '', /^[A-Za-z0-9+/]+=*$/);
    assert.equal(plainExcerpt('<p>Olá **mundo**</p>\n\n[link](http://x)'), 'Olá mundo link');
    const d = (s: string) => new Date(s);
    assert.equal(
      retentionReference({ closesAt: d('2026-01-01'), closedAt: d('2026-02-01'), archivedAt: null, event: { date: d('2026-03-01') } })?.toISOString(),
      d('2026-03-01').toISOString(),
    );
    assert.equal(retentionReference({ closesAt: null, closedAt: null, archivedAt: null, event: null }), null);
    assert.equal(retentionCutoffForUndated(d('2026-10-18T00:00:00Z'), 12).toISOString(), d('2025-10-18T00:00:00Z').toISOString());
  });

  // ------------------------------------------------------------------------------------------------ pos-auditoria

  it('IP: IPv6 agrupado por /64 (sufixo trocado = mesma chave/hash); IPv4 mapeado = IPv4', () => {
    assert.equal(clientIpKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
    assert.equal(clientIpKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
    assert.equal(clientIpKey('::ffff:10.0.0.7'), '10.0.0.7');
    assert.equal(clientIpKey('10.0.0.7'), '10.0.0.7');
    assert.equal(clientIpKey('::1'), '0:0:0:0::/64');
    assert.equal(hashIp('2001:db8:1:2::5'), hashIp('2001:db8:1:2:9:9:9:9'));
    assert.notEqual(hashIp('2001:db8:1:2::5'), hashIp('2001:db8:1:3::5'));
    assert.equal(hashIp(undefined), null);
  });

  it('startedToken: assinado pelo servidor, preso ao slug, sem forja', () => {
    const t = issueStartedToken('meu-form-abc12', 1_760_000_000_000);
    assert.equal(verifyStartedToken('meu-form-abc12', t), 1_760_000_000_000);
    assert.equal(verifyStartedToken('outro-form-abc12', t), null);
    assert.equal(verifyStartedToken('meu-form-abc12', t.replace(/^\d+/, '1760000009999')), null, 'instante trocado');
    assert.equal(verifyStartedToken('meu-form-abc12', 'lixo'), null);
    assert.equal(verifyStartedToken('meu-form-abc12', 123), null);
  });

  it('chaves: e-mail normalizado (Gmail), chave de campo sem nomes do prototipo, answers sem ler o prototipo', () => {
    assert.equal(emailDedupKey('Fulano.Silva+evento@GMAIL.com'), 'fulanosilva@gmail.com');
    assert.equal(emailDedupKey('f.u.l.a.n.o.silva@googlemail.com'), 'fulanosilva@gmail.com');
    assert.equal(emailDedupKey('joao.souza+x@empresa.com.br'), 'joao.souza@empresa.com.br', 'pontos so caem no Gmail');
    for (const k of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'prototype']) assert.ok(!FIELD_KEY_REGEX.test(k), k);
    assert.ok(FIELD_KEY_REGEX.test('constructor_nome'));
    // campo "toString" (definicao antiga) obrigatorio e sem resposta: "Campo obrigatorio" (nunca a funcao do prototipo)
    const r = validateAnswers([{ key: 'toString', type: 'SHORT_TEXT', required: true, options: null, validation: null, showIf: null }], {});
    assert.deepEqual(r.errors, { toString: 'Campo obrigatório.' });
  });

  it('modelos: definicao valida (showIf para tras), menor -> responsavel + autorizacao, imagem opcional e separada', () => {
    for (const key of TEMPLATE_KEYS) {
      const fields = FORM_TEMPLATES[key].sections.flatMap((s) => s.fields);
      assert.deepEqual(validateFields(fields).errors, {}, key);
    }
    for (const key of ['CAMPEONATO', 'BATIZADO'] as const) {
      const fields = FORM_TEMPLATES[key].sections.flatMap((s) => s.fields);
      const byKey = (k: string) => fields.find((f) => f.key === k);
      assert.ok(byKey('data_nascimento') && byKey('menor_idade'), key);
      assert.equal(byKey('responsavel_autorizacao')?.type, 'CONSENT');
      assert.deepEqual(byKey('responsavel_autorizacao')?.showIf, { fieldKey: 'menor_idade', equals: 'Sim' });
      assert.equal(byKey('termo_imagem')?.required, false);
      const answers = validateAnswers(
        fields.map((f) => ({ key: f.key, type: f.type, required: f.required ?? false, options: f.options ?? null, validation: null, showIf: f.showIf ?? null })),
        { menor_idade: 'Sim' },
      );
      for (const k of ['responsavel_nome', 'responsavel_cpf', 'responsavel_telefone', 'responsavel_parentesco', 'responsavel_autorizacao']) assert.ok(answers.errors[k], `${key}.${k}`);
      assert.ok(!answers.errors.termo_imagem, 'imagem nunca obrigatoria');
    }
  });

  it('termo efetivo (texto + CONSENTs), texto padrao verdadeiro, banner so https, fila com teto, teto de arquivo 9 MB, modo da retencao', () => {
    const text = effectiveConsentText({ consentText: null, retentionMonths: 6 }, [
      { key: 'a', type: 'CONSENT', label: 'Aceito A.', required: true },
      { key: 'b', type: 'CONSENT', label: 'Aceito B.', required: false },
      { key: 'c', type: 'CONSENT', label: 'Arquivado.', required: true, archived: true },
      { key: 'n', type: 'SHORT_TEXT', label: 'Nome', required: true },
    ]);
    assert.ok(text.startsWith(defaultConsentText(6)));
    assert.ok(text.includes('[a] Aceito A.') && text.includes('[b (opcional)] Aceito B.') && !text.includes('Arquivado') && !text.includes('Nome'));
    assert.match(defaultConsentText(12), /apagados ou anonimizados 12 meses/);
    assert.match(defaultConsentText(12), /solicite ao organizador/);
    assert.equal(safeBannerUrl('http://x.test/a.png'), null);
    assert.equal(safeBannerUrl('https://x.test/a.png'), 'https://x.test/a.png');
    assert.equal(safeBannerUrl('/api/uploads/00000000-0000-4000-8000-000000000000.webp'), '/api/uploads/00000000-0000-4000-8000-000000000000.webp');
    assert.equal(waitlistCap(null, {}), 200);
    assert.equal(waitlistCap(30, {}), 30);
    assert.equal(waitlistCap(500, { FORMS_WAITLIST_MAX: '50' }), 50);
    const open = { status: 'OPEN' as const, opensAt: null, closesAt: null, maxSubmissions: 2, allowWaitlist: true, event: null };
    assert.equal(closedReasonOf(open, 2, new Date(), 1), null);
    assert.equal(closedReasonOf(open, 2, new Date(), 2), 'FULL');
    assert.equal(formsFileMaxBytes({ FORMS_FILE_MAX_MB: '20' }), 9 * 1024 * 1024);
    assert.equal(formsFileMaxBytes({ FORMS_FILE_MAX_MB: '3' }), 3 * 1024 * 1024);
    assert.equal(formsFileMaxBytes({}), 5 * 1024 * 1024);
    assert.equal(formsRetentionModeLabel({}), 'dry-run');
    assert.equal(formsRetentionModeLabel({ FORMS_RETENTION_PURGE: 'true' }), 'true');
    assert.equal(formsRetentionModeLabel({ FORMS_RETENTION_PURGE: 'false' }), 'false');
  });

  it('e-mail da inscricao: saudacao fixa, sem nome do inscrito; titulo do Mestre escapado no HTML', () => {
    const m = renderRegistrationNoticeMail({ notice: 'RECEIVED', formTitle: '<b>Camp</b>', protocol: 'INS-ABCDEF', link: 'https://app.test/i/x' });
    assert.ok(m.text.startsWith('Olá!\n'));
    assert.ok(m.html.includes('&lt;b&gt;Camp&lt;/b&gt;') && !m.html.includes('<b>Camp'));
  });
});
