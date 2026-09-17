import assert from 'node:assert/strict';

/** Confere um subconjunto de campos de um objeto — equivalente simples ao
 * `expect(x).toMatchObject(y)` do Jest, usando node:assert puro (sem Jest). */
export function assertMatchObject(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(
      actual[key],
      value,
      `campo "${key}": esperado ${JSON.stringify(value)}, recebido ${JSON.stringify(actual[key])}`,
    );
  }
}
