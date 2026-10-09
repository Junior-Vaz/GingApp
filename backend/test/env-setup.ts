// Roda antes de cada arquivo de teste (jest "setupFiles"), no mesmo processo dos testes —
// diferente de global-setup.ts (processo separado, só migration+seed). Sobe o limite do
// throttle de login (padrão 5/min em produção) para a suíte inteira não esbarrar nele: vários
// specs fazem login de verdade em sequência.
process.env.LOGIN_THROTTLE_LIMIT = '100';
// Idem para POST /organizations (padrão de produção: 10/min): organizations-create.e2e-spec.ts cria
// dezenas de grupos em sequência. O spec testa o rate limit por conta própria (limite rebaixado).
process.env.ORG_CREATE_THROTTLE_LIMIT = '100';
