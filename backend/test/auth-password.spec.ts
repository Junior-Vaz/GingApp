import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChangePasswordDto } from '../src/interface/http/auth/dto/change-password.dto';
import { LoginDto } from '../src/interface/http/auth/dto/login.dto';
import { PlatformLoginDto } from '../src/interface/http/auth/dto/platform-login.dto';
import { ResetMestrePasswordDto } from '../src/interface/http/organizations/dto/reset-mestre-password.dto';
import {
  BCRYPT_ROUNDS,
  isForbiddenPassword,
  NEW_PASSWORD_MIN_LENGTH,
  normalizeEmail,
  PASSWORD_MAX_BYTES,
  passwordByteLength,
} from '../src/shared/security/password-policy';
import { isRevokedByCutoff, issuedAtFor, revocationCutoff } from '../src/shared/security/token-revocation';

/**
 * Regras puras da troca/reset de senha e da revogação de sessões — a política (SSOT em
 * shared/security/password-policy.ts), a normalização do e-mail de login e, principalmente, a aritmética
 * de segundos x milissegundos do tokenValidAfter (token novo nunca nasce revogado; token antigo do mesmo
 * segundo da revogação sempre morre). O comportamento HTTP está em auth-password.e2e-spec.ts.
 */

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = <T>(metatype: new () => T, body: unknown): Promise<T> =>
  pipe.transform(body, { type: 'body', metatype }) as Promise<T>;
async function messagesOf(metatype: new () => unknown, body: unknown): Promise<string[]> {
  try {
    await validate(metatype, body);
  } catch (error) {
    assert.ok(error instanceof BadRequestException, String(error));
    return ([] as string[]).concat((error.getResponse() as { message: string | string[] }).message);
  }
  return [];
}

describe('password-policy — SSOT', () => {
  it('constantes: custo bcrypt 10, mínimo 12, máximo 72 bytes', () => {
    assert.equal(BCRYPT_ROUNDS, 10);
    assert.equal(NEW_PASSWORD_MIN_LENGTH, 12);
    assert.equal(PASSWORD_MAX_BYTES, 72);
  });

  it('isForbiddenPassword: Dev@12345 em qualquer caixa e embutida; senhas boas passam', () => {
    for (const bad of ['Dev@12345', 'dev@12345', 'DEV@12345', 'xxDeV@12345yy', 'Dev@12345!!!']) {
      assert.equal(isForbiddenPassword(bad), true, bad);
    }
    for (const good of ['Mestre#Seguro2026', 'Dev@1234', 'Dev 12345 12345']) {
      assert.equal(isForbiddenPassword(good), false, good);
    }
  });

  it('passwordByteLength conta bytes UTF-8 (não caracteres)', () => {
    assert.equal(passwordByteLength('abc'), 3);
    assert.equal(passwordByteLength('ção'), 5);
    assert.equal(passwordByteLength('😀'), 4);
  });

  it('normalizeEmail apara e põe em minúsculas', () => {
    assert.equal(normalizeEmail('  Mestre@GingaBrasil.COM.br \n'), 'mestre@gingabrasil.com.br');
  });
});

describe('token-revocation — resolução de segundos x milissegundos', () => {
  const T = Date.UTC(2026, 9, 9, 12, 0, 0, 0); // exatamente em um segundo cheio (pior caso: ms = 0)

  it('revocationCutoff fica 1 ms à frente de agora', () => {
    assert.equal(revocationCutoff(T).getTime(), T + 1);
  });

  it('isRevokedByCutoff: sem corte nunca revoga; antes do corte revoga; igual ou depois não', () => {
    const cutoff = new Date(T + 500);
    assert.equal(isRevokedByCutoff(1, null), false);
    assert.equal(isRevokedByCutoff(1, undefined), false);
    assert.equal(isRevokedByCutoff(T / 1000 - 1, cutoff), true);
    assert.equal(isRevokedByCutoff(T / 1000, cutoff), true); // iat*1000 = T < T+500
    assert.equal(isRevokedByCutoff(T / 1000 + 1, cutoff), false);
  });

  it('TODO token emitido até o instante da revogação morre — inclusive no mesmo segundo, mesmo com ms = 0', () => {
    for (const offsetMs of [0, 1, 250, 999]) {
      const now = T + offsetMs;
      const cutoff = revocationCutoff(now);
      const oldTokenIat = Math.floor(now / 1000); // emitido no mesmo segundo da revogação
      assert.equal(isRevokedByCutoff(oldTokenIat, cutoff), true, `offset ${offsetMs}`);
      assert.equal(isRevokedByCutoff(oldTokenIat - 3600, cutoff), true);
    }
  });

  it('issuedAtFor: sem corte = relógio atual; com corte futuro = primeiro segundo inteiro >= corte', () => {
    assert.equal(issuedAtFor(null, T + 700), T / 1000);
    assert.equal(issuedAtFor(undefined, T + 700), T / 1000);
    assert.equal(issuedAtFor(new Date(T - 86_400_000), T + 700), T / 1000); // corte antigo não adianta o iat
    assert.equal(issuedAtFor(new Date(T + 500), T), T / 1000 + 1); // corte no meio do segundo => próximo segundo
    assert.equal(issuedAtFor(new Date(T + 1), T), T / 1000 + 1);
    assert.equal(issuedAtFor(new Date(T), T), T / 1000); // corte exatamente no segundo cheio
  });

  it('o token NOVO (iat de issuedAtFor) nunca é revogado pelo corte que o motivou, em nenhum milissegundo', () => {
    for (let offsetMs = 0; offsetMs < 1000; offsetMs += 7) {
      const now = T + offsetMs;
      const cutoff = revocationCutoff(now);
      assert.equal(isRevokedByCutoff(issuedAtFor(cutoff, now), cutoff), false, `offset ${offsetMs}`);
      // e um login 300 ms depois (ainda no mesmo segundo) também nasce válido
      assert.equal(isRevokedByCutoff(issuedAtFor(cutoff, now + 300), cutoff), false, `login +300 offset ${offsetMs}`);
    }
  });
});

describe('DTOs — política da senha nova e normalização do e-mail', () => {
  const GOOD = 'Troca#Segura2026';
  const current = 'Atual#Senha2026';

  it('ChangePasswordDto aceita senha boa e devolve só os dois campos', async () => {
    const dto = await validate(ChangePasswordDto, { currentPassword: current, newPassword: GOOD });
    assert.deepEqual({ ...dto }, { currentPassword: current, newPassword: GOOD });
  });

  it('recusa: 11 caracteres, 73 bytes, Dev@12345 (qualquer caixa/embutida), não-string, ausente e campos extras', async () => {
    const bad: Array<[string, unknown]> = [
      ['11 chars', 'Abcdef#12345'.slice(0, 11)],
      ['73 bytes', 'a'.repeat(73)],
      ['73 bytes multibyte', 'ç'.repeat(37)], // 74 bytes
      ['Dev@12345', 'Dev@12345'],
      ['dev@12345 embutida', 'xxxDEV@12345yyy'],
      ['número', 123456789012],
      ['objeto', { $ne: '' }],
      ['array', ['a'.repeat(20)]],
      ['null', null],
      ['ausente', undefined],
    ];
    for (const [label, newPassword] of bad) {
      const messages = await messagesOf(ChangePasswordDto, { currentPassword: current, newPassword });
      assert.ok(messages.some((m) => m.startsWith('newPassword')), `${label}: ${JSON.stringify(messages)}`);
    }
    assert.ok((await messagesOf(ChangePasswordDto, { currentPassword: current, newPassword: GOOD, extra: 1 })).length > 0);
    assert.ok((await messagesOf(ChangePasswordDto, { currentPassword: current, newPassword: GOOD, userId: 1 })).length > 0);
  });

  it('limites exatos: 12 caracteres e 72 bytes passam; 72 bytes multibyte passam', async () => {
    await validate(ChangePasswordDto, { currentPassword: current, newPassword: 'Abcdef#12345' }); // 12
    await validate(ChangePasswordDto, { currentPassword: current, newPassword: `${'a'.repeat(71)}1` }); // 72 bytes
    await validate(ChangePasswordDto, { currentPassword: current, newPassword: 'ç'.repeat(36) }); // 72 bytes
  });

  it('currentPassword: obrigatória, texto, 1..1000 (sem política: contas antigas)', async () => {
    assert.ok((await messagesOf(ChangePasswordDto, { newPassword: GOOD })).some((m) => m.startsWith('currentPassword')));
    assert.ok((await messagesOf(ChangePasswordDto, { currentPassword: '', newPassword: GOOD })).length > 0);
    assert.ok((await messagesOf(ChangePasswordDto, { currentPassword: 7, newPassword: GOOD })).length > 0);
    assert.ok((await messagesOf(ChangePasswordDto, { currentPassword: 'x'.repeat(1001), newPassword: GOOD })).length > 0);
    await validate(ChangePasswordDto, { currentPassword: 'curta', newPassword: GOOD }); // senha antiga fraca ainda "confere"
  });

  it('as mensagens de erro nunca contêm o valor enviado', async () => {
    const secret = 'Dev@12345-segredo-nao-pode-vazar';
    const messages = await messagesOf(ChangePasswordDto, { currentPassword: current, newPassword: secret });
    assert.ok(messages.length > 0);
    assert.ok(messages.every((m) => !m.includes(secret) && !m.includes(current)), JSON.stringify(messages));
  });

  it('ResetMestrePasswordDto: mesma política, só newPassword', async () => {
    await validate(ResetMestrePasswordDto, { newPassword: GOOD });
    for (const body of [{}, { newPassword: 'curta' }, { newPassword: 'Dev@12345' }, { newPassword: GOOD, password: GOOD }]) {
      assert.ok((await messagesOf(ResetMestrePasswordDto, body)).length > 0, JSON.stringify(body));
    }
  });

  it('LoginDto/PlatformLoginDto normalizam o e-mail antes de validar (maiúsculas e espaços)', async () => {
    const login = await validate(LoginDto, { email: '  Mestre@GingaBrasil.com.BR ', password: 'segredo123' });
    assert.equal(login.email, 'mestre@gingabrasil.com.br');
    const platform = await validate(PlatformLoginDto, { email: '\tOWNER@GingApp.com.br\n', password: 'segredo123' });
    assert.equal(platform.email, 'owner@gingapp.com.br');
    assert.ok((await messagesOf(LoginDto, { email: 'nao-e-email', password: 'segredo123' })).length > 0);
    assert.ok((await messagesOf(LoginDto, { email: 123, password: 'segredo123' })).length > 0);
  });
});
