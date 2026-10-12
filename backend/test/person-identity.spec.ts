import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldRunPersonBackfill } from '../prisma/person-backfill';
import { GINGAPP_CODE_ALPHABET, generateGingappCode, normalizeGingappCode } from '../src/interface/http/people/gingapp-code';
import { namesLookAlike } from '../src/interface/http/people/person-linker';
import { transferContestDays, transferExpiryDays } from '../src/interface/http/people/transfers.service';
import { isTransferCronEnabled } from '../src/jobs/transfer-cron.service';
import { parseStudentRow } from '../src/interface/http/students/student-import';
import {
  decryptPersonDocument,
  hashPersonDocument,
  maskPersonDocument,
  maskStudentDocument,
  parseCpf,
  personDocumentKey,
} from '../src/shared/security/person-document';

/** Regras puras da ficha unica (docs/FICHA_UNICA.md): codigo GingApp, CPF cifrado/hash, similaridade, backfill, CSV. */
describe('ficha unica - regras puras', () => {
  it('codigo GingApp: formato GING-XXXX-XXXX, sem 0/O/1/I, verificador confere', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateGingappCode();
      assert.match(code, /^GING-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      assert.equal(normalizeGingappCode(code), code);
      assert.equal(normalizeGingappCode(code.toLowerCase().replace(/-/g, ' ')), code, 'aceita minusculas/espacos');
      assert.equal(normalizeGingappCode(code.slice(5)), code, 'aceita sem o prefixo');
    }
    assert.ok(!/[01OI]/.test(GINGAPP_CODE_ALPHABET));
  });

  it('codigo GingApp: qualquer troca de UM caractere e rejeitada pelo verificador', () => {
    const code = generateGingappCode();
    const raw = code.replace(/^GING-/, '').replace('-', '');
    for (let pos = 0; pos < raw.length; pos++) {
      for (const c of GINGAPP_CODE_ALPHABET) {
        if (c === raw[pos]) continue;
        const typo = raw.slice(0, pos) + c + raw.slice(pos + 1);
        assert.equal(normalizeGingappCode(typo), null, `${typo} deveria ser invalido`);
      }
    }
    assert.equal(normalizeGingappCode('GING-0000-0000'), null);
    assert.equal(normalizeGingappCode(''), null);
  });

  it('CPF: valida digitos verificadores; chave cifrada nao contem o CPF; hash deterministico; mascara so 2 digitos', () => {
    assert.equal(parseCpf('529.982.247-25'), '52998224725');
    assert.equal(parseCpf('529.982.247-24'), null);
    assert.equal(parseCpf('111.111.111-11'), null);
    assert.equal(parseCpf('DOC-123'), null);
    const key = personDocumentKey('CPF', '52998224725');
    assert.equal(key.kind, 'CPF');
    assert.equal(key.last4, '4725');
    assert.ok(!key.enc.includes('52998224725') && !key.hash.includes('52998224725'));
    assert.equal(key.hash, personDocumentKey('CPF', '52998224725').hash, 'mesmo CPF = mesmo hash (busca)');
    assert.notEqual(key.enc, personDocumentKey('CPF', '52998224725').enc, 'IV novo a cada cifragem');
    assert.equal(decryptPersonDocument(key.enc), 'CPF:52998224725');
    assert.equal(maskPersonDocument(key.last4), '***.***.***-25');
    assert.equal(maskPersonDocument(null), null);
  });

  it('CPF do responsavel: a chave inclui a data de nascimento (irmaos diferem) e nunca colide com o CPF proprio', () => {
    const a = personDocumentKey('GUARDIAN_CPF', '52998224725', new Date('2015-01-02T00:00:00Z'));
    const b = personDocumentKey('GUARDIAN_CPF', '52998224725', new Date('2017-05-06T00:00:00Z'));
    assert.notEqual(a.hash, b.hash);
    assert.notEqual(a.hash, personDocumentKey('CPF', '52998224725').hash);
    assert.equal(a.hash, hashPersonDocument('GUARDIAN_CPF:52998224725:2015-01-02'));
    assert.throws(() => personDocumentKey('GUARDIAN_CPF', '52998224725', null));
  });

  it('pepper diferente = hash diferente (por isso PERSON_DOC_PEPPER nunca pode ser trocado)', () => {
    const before = process.env.PERSON_DOC_PEPPER;
    try {
      process.env.PERSON_DOC_PEPPER = 'pepper-a';
      const a = hashPersonDocument('CPF:52998224725');
      process.env.PERSON_DOC_PEPPER = 'pepper-b';
      assert.notEqual(hashPersonDocument('CPF:52998224725'), a);
    } finally {
      if (before === undefined) delete process.env.PERSON_DOC_PEPPER;
      else process.env.PERSON_DOC_PEPPER = before;
    }
  });

  it('nome parecido: sem acento/caixa/espacos, ou mesmo primeiro + ultimo nome', () => {
    assert.ok(namesLookAlike('João  da Silva', 'joao DA silva'));
    assert.ok(namesLookAlike('Maria Aparecida Souza', 'Maria Souza'));
    assert.ok(!namesLookAlike('Maria Souza', 'Mariana Souza'));
    assert.ok(!namesLookAlike('Pedro', 'Pedro Lima'));
  });

  it('backfill no boot: false nunca, true sempre, padrao so com matricula sem ficha; manual sempre', () => {
    assert.equal(shouldRunPersonBackfill('auto', { PERSON_BACKFILL: 'false' }, 10), false);
    assert.equal(shouldRunPersonBackfill('auto', { PERSON_BACKFILL: 'true' }, 0), true);
    assert.equal(shouldRunPersonBackfill('auto', {}, 0), false);
    assert.equal(shouldRunPersonBackfill('auto', {}, 3), true);
    assert.equal(shouldRunPersonBackfill('manual', {}, 0), true);
    assert.equal(shouldRunPersonBackfill('manual', { PERSON_BACKFILL: 'false' }, 5), false);
  });

  it('fase 2: CPF legado mascarado; prazos de transferencia por env; job desligavel', () => {
    assert.equal(maskStudentDocument('529.982.247-25'), '***.***.***-25');
    assert.equal(maskStudentDocument('52998224725'), '***.***.***-25');
    assert.equal(maskStudentDocument('RG 12.345'), '***45');
    assert.equal(maskStudentDocument('  '), null);
    assert.equal(maskStudentDocument(null), null);
    assert.equal(transferExpiryDays({}), 14);
    assert.equal(transferExpiryDays({ TRANSFER_EXPIRY_DAYS: '30' }), 30);
    assert.equal(transferExpiryDays({ TRANSFER_EXPIRY_DAYS: 'x' }), 14);
    assert.equal(transferContestDays({}), 7);
    assert.equal(transferContestDays({ TRANSFER_CONTEST_DAYS: '0' }), 7);
    assert.equal(isTransferCronEnabled({ TRANSFER_CRON: 'false' }), false);
    assert.equal(isTransferCronEnabled({}), true);
  });

  it('linha do CSV: CPF do responsavel exige nascimento e CPF valido; codigo GingApp validado', () => {
    const today = new Date('2026-10-12T00:00:00Z');
    const code = generateGingappCode();
    const ok = parseStudentRow(
      { name: 'Ana Lima', birthDate: '02/01/2015', guardianDocument: '529.982.247-25', gingappCode: code.toLowerCase() },
      new Map(),
      today,
    );
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.row.guardianDocument, '52998224725');
      assert.equal(ok.row.gingappCode, code);
    }
    const bad = parseStudentRow({ name: 'Ana Lima', guardianDocument: '123', gingappCode: 'GING-XXXX' }, new Map(), today);
    assert.ok(!bad.ok);
    if (!bad.ok) assert.deepEqual(bad.errors, ['CPF do responsável inválido.', 'Código GingApp inválido.']);
    const noBirth = parseStudentRow({ name: 'Ana Lima', guardianDocument: '529.982.247-25' }, new Map(), today);
    assert.ok(!noBirth.ok);
    if (!noBirth.ok) assert.deepEqual(noBirth.errors, ['Informe a data de nascimento para usar o CPF do responsável.']);
  });
});
