import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ResetStudentPasswordDto } from '../src/shared/security/reset-member-password.dto';
import {
  isForbiddenPassword,
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  passwordByteLength,
} from '../src/shared/security/password-policy';
import {
  generateTemporaryPassword,
  isOffensive,
  providedOrGeneratedPassword,
  TEMPORARY_PASSWORD_BLOCKLIST,
  TEMPORARY_PASSWORD_WORDS,
} from '../src/shared/security/temporary-password';

/** Gerador da senha provisória fácil: formato, política da senha nova, lista curada e unicidade estatística. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const FORMAT = /^[A-Z][a-z]+[A-Z][a-z]+[2-9]{2}$/;

describe('generateTemporaryPassword', () => {
  it('lista de palavras: ~100, 5-6 letras, sem acento, capitalizadas, sem repetição e sem termo impróprio', () => {
    assert.ok(TEMPORARY_PASSWORD_WORDS.length >= 100, `só ${TEMPORARY_PASSWORD_WORDS.length} palavras`);
    assert.equal(new Set(TEMPORARY_PASSWORD_WORDS).size, TEMPORARY_PASSWORD_WORDS.length, 'sem palavras repetidas');
    for (const word of TEMPORARY_PASSWORD_WORDS) {
      assert.match(word, /^[A-Z][a-z]{4,5}$/, `palavra fora do padrão: ${word}`);
      assert.ok(!isOffensive(word), `palavra imprópria na lista: ${word}`);
    }
    assert.ok(TEMPORARY_PASSWORD_BLOCKLIST.length > 0);
  });

  it('pares que formam termo impróprio na junção ("Gente"+"Tarde") existem mas são POUCOS (o gerador os descarta e sorteia de novo)', () => {
    assert.ok(isOffensive('GenteTarde22'), 'a junção gentetarde contém "teta"');
    const total = TEMPORARY_PASSWORD_WORDS.length ** 2;
    let blocked = 0;
    for (const a of TEMPORARY_PASSWORD_WORDS) for (const b of TEMPORARY_PASSWORD_WORDS) if (isOffensive(`${a}${b}`)) blocked++;
    assert.ok(blocked / total < 0.02, `bloqueio demais: ${blocked}/${total}`);
  });

  it('1000 amostras: formato PalavraPalavraNN, política da senha nova e nunca imprópria', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const password = generateTemporaryPassword();
      seen.add(password);
      assert.match(password, FORMAT, password);
      assert.ok(password.length >= NEW_PASSWORD_MIN_LENGTH, `curta: ${password}`);
      assert.ok(passwordByteLength(password) <= PASSWORD_MAX_BYTES);
      assert.ok(!isForbiddenPassword(password));
      assert.ok(!isOffensive(password), `imprópria: ${password}`);
      assert.ok(/^[\x20-\x7e]+$/.test(password), 'só ASCII (sem acento)');
    }
    // Unicidade estatística: ~640 mil combinações; em 1000 sorteios o esperado são ~1 repetição (aceitamos até 10).
    assert.ok(seen.size >= 990, `repetições demais: ${1000 - seen.size}`);
  });

  it('é aceita pela validação real da senha nova (@IsNewPassword) usada nas rotas de reset', async () => {
    for (let i = 0; i < 200; i++) {
      const dto = (await pipe.transform({ newPassword: generateTemporaryPassword() }, { type: 'body', metatype: ResetStudentPasswordDto })) as ResetStudentPasswordDto;
      assert.ok(dto.newPassword);
    }
    // newPassword omitida é válida (o servidor gera); informada fraca continua recusada.
    await pipe.transform({}, { type: 'body', metatype: ResetStudentPasswordDto });
    await assert.rejects(() => pipe.transform({ newPassword: 'curta' }, { type: 'body', metatype: ResetStudentPasswordDto }));
    await assert.rejects(() => pipe.transform({ newPassword: 'Dev@12345' }, { type: 'body', metatype: ResetStudentPasswordDto }));
  });

  it('usa as duas palavras diferentes e a distribuição não é constante (palavras, dígitos)', () => {
    const firstWords = new Set<string>();
    const lastDigits = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const password = generateTemporaryPassword();
      const [first, second] = password.match(/[A-Z][a-z]+/g) as string[];
      assert.notEqual(first, second);
      firstWords.add(first);
      lastDigits.add(password.slice(-1));
    }
    assert.ok(firstWords.size > 50, 'primeira palavra pouco variada');
    assert.equal(lastDigits.size, 8, 'os 8 dígitos 2-9 aparecem');
  });
});

describe('providedOrGeneratedPassword', () => {
  it('informada => devolve como veio (sem gerar); ausente (undefined/null) => gera e marca generated', () => {
    assert.deepEqual(providedOrGeneratedPassword('Minha@Senha2026'), { password: 'Minha@Senha2026', generated: false });
    for (const absent of [undefined, null]) {
      const chosen = providedOrGeneratedPassword(absent);
      assert.equal(chosen.generated, true);
      assert.match(chosen.password, FORMAT);
    }
  });
});
