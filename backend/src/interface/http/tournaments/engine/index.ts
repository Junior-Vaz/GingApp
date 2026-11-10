/**
 * Motor de chaveamento (funções PURAS, sem Prisma/Nest/Date.now/Math.random). Contrato: docs/CONTRATO_CHAVEAMENTO.md §3.
 */
export * from './types';
export { createRng } from './rng';
export { generateSingleElimination } from './single-elimination';
export { generateRoundRobin } from './round-robin';
export { generateGroups } from './groups';
export { computeStandings } from './standings';
export { buildKnockoutFromGroups } from './knockout-from-groups';
export { resolveAdvancement } from './advancement';
export { computePodium } from './podium';
