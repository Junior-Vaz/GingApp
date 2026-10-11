// Roda antes de cada arquivo de teste (jest "setupFiles"), no mesmo processo dos testes —
// diferente de global-setup.ts (processo separado, só migration+seed). Sobe o limite do
// throttle de login (padrão 5/min em produção) para a suíte inteira não esbarrar nele: vários
// specs fazem login de verdade em sequência.
process.env.LOGIN_THROTTLE_LIMIT = '100';
// Idem para POST /organizations (padrão de produção: 10/min): organizations-create.e2e-spec.ts cria
// dezenas de grupos em sequência. O spec testa o rate limit por conta própria (limite rebaixado).
process.env.ORG_CREATE_THROTTLE_LIMIT = '100';
// Idem para POST /auth/change-password (padrão de produção: 5/min por IP e por usuário) e para o reset de
// senha de MESTRE (10/min): auth-password.e2e-spec.ts troca/reseta dezenas de senhas em sequência e prova o
// rate limit por conta própria (limite rebaixado).
process.env.CHANGE_PASSWORD_THROTTLE_LIMIT = '100';
process.env.MESTRE_RESET_THROTTLE_LIMIT = '100';
// Sem o job diario de mensalidade vencida (@nestjs/schedule) nos testes: nenhum timer/cron e registrado
// (AppModule so inclui ScheduleModule/JobsModule quando OVERDUE_CRON != 'false'). O job e testado a parte
// em test/overdue-cron.spec.ts (registro do cron e execucao direta, sem esperar o relogio).
process.env.OVERDUE_CRON = 'false';
