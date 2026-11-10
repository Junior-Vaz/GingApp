/**
 * RNG determinístico do motor de chaveamento (mulberry32 com a semente embaralhada antes).
 * Mesma semente => mesma sequência. NUNCA usar Math.random()/Date.now() no motor.
 */

/** Mistura a semente (sementes consecutivas 1, 2, 3 não geram fluxos parecidos). */
function mixSeed(seed: number): number {
  let x = (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Devolve uma função que gera números em [0, 1), determinística para a mesma semente. */
export function createRng(seed: number): () => number {
  let a = mixSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Embaralha (Fisher-Yates) uma CÓPIA do array usando o rng dado. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
