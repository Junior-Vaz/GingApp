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

// Nunca Web Push real nos testes (o push so liga quando o spec injeta o remetente em memoria; VAPID_* vazias).
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.VAPID_SUBJECT = "";
// Idem FCM: nunca o Firebase real nos testes (so liga quando o spec injeta o remetente em memoria). O aviso de teste
// (POST /push/test, 3/min) sobe aqui; push.e2e-spec.ts prova o rate limit com um limite proprio.
for (const name of [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_WEB_API_KEY',
  'FIREBASE_WEB_AUTH_DOMAIN',
  'FIREBASE_WEB_STORAGE_BUCKET',
  'FIREBASE_WEB_MESSAGING_SENDER_ID',
  'FIREBASE_WEB_APP_ID',
  'FIREBASE_WEB_VAPID_KEY',
]) {
  process.env[name] = '';
}
process.env.PUSH_TEST_THROTTLE_LIMIT = '1000';
// Retencao da auditoria (semanal), limpeza de imagens orfas (semanal), log de requisicao e 2FA: nada disso roda nos
// testes por padrao (os specs proprios chamam os servicos direto / ligam a env que precisam).
process.env.AUDIT_RETENTION_CRON = 'false';
process.env.UPLOADS_GC = 'false';
process.env.REQUEST_LOG = 'false';
process.env.TWO_FACTOR_THROTTLE_LIMIT = '1000';
// Ginga Rank: sem o recalculo noturno (02:30) nem o fechamento mensal de temporada nos testes (RankingCronService e' chamado direto
// pelos specs; o motor RankingService tambem).
process.env.RANKING_CRON = 'false';
// Aulas continuas (geracao rolante diaria 01:30): sem o job nos testes (LessonsCronService/ClassLessonsRollingService sao chamados
// direto pelos specs; so o job agendado fica desligado — criar/editar turma continua gerando aulas, fire-and-forget).
process.env.LESSONS_CRON = 'false';
