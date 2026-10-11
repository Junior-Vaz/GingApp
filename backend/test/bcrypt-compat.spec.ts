import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';

/**
 * Compatibilidade de hashes gravados com o bcrypt 5.x (producao) com o bcrypt 6.x: o formato $2b$ e o
 * mesmo, entao contas existentes continuam logando apos o upgrade. O hash abaixo foi GERADO pelo
 * bcrypt 5.1.1 (custo 10) para a senha 'Senha@123'.
 */
const HASH_BCRYPT_5 = '$2b$10$lRJ21KN7MzaIaznVM3XpgO6s6ImhdbYwjuno9oyaBsQB1xK8I/8zS';

describe('bcrypt 6 - compatibilidade com hashes do bcrypt 5', () => {
  it('compara true com a senha certa e false com a errada', async () => {
    assert.equal(await bcrypt.compare('Senha@123', HASH_BCRYPT_5), true);
    assert.equal(await bcrypt.compare('Senha@124', HASH_BCRYPT_5), false);
    assert.equal(bcrypt.getRounds(HASH_BCRYPT_5), 10);
  });

  it('hash novo mantem prefixo $2b$ e custo 10', async () => {
    const hash = await bcrypt.hash('Outra@Senha1', 10);
    assert.ok(hash.startsWith('$2b$10$'));
    assert.equal(await bcrypt.compare('Outra@Senha1', hash), true);
  });
});