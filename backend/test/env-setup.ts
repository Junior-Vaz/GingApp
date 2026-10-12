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
// "Esqueci a senha" (E05): limites por IP e por e-mail altos; password-reset.e2e-spec.ts prova o rate limit
// por conta própria (FORGOT_EMAIL_THROTTLE_LIMIT é lido a cada pedido). URLs dos frontends para os links dos e-mails.
process.env.FORGOT_THROTTLE_LIMIT = '1000';
process.env.RESET_THROTTLE_LIMIT = '1000';
process.env.FORGOT_EMAIL_THROTTLE_LIMIT = '1000';
process.env.APP_URL = 'https://app.e2e.test';
process.env.PAINEL_URL = 'https://painel.e2e.test';
process.env.ADMIN_URL = 'https://admin.e2e.test';
// Nunca SMTP real nos testes (o e-mail só liga quando o spec injeta o transporte em memória).
process.env.SMTP_HOST = '';
// Sem o job diario de mensalidade vencida (@nestjs/schedule) nos testes: nenhum timer/cron e registrado
// (AppModule so inclui ScheduleModule/JobsModule quando OVERDUE_CRON != 'false'). O job e testado a parte
// em test/overdue-cron.spec.ts (registro do cron e execucao direta, sem esperar o relogio).
process.env.OVERDUE_CRON = 'false';
