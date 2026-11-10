# Contrato — Trocar o dia da semana de uma turma: cancelar as aulas futuras do dia antigo e gerar de novo no dia novo

Origem: pergunta do dono (09/11) "nos cadastros de aulas contínuas, se eu editar dias/horas/dados, atualiza as aulas geradas?" — resposta: professor, horário e unidade já acompanham (`ClassesService.syncFutureLessons`), mas o **dia da semana não movia nada** (as aulas do dia antigo ficavam ativas e nasciam outras no dia novo: a turma aparecia nos dois dias). Decisão do dono: "sim, melhor... e regerada novamente?" => cancelar as do dia antigo e gerar de novo.

## 1. Regra (backend, `PATCH /classes/:id`)
Quando o PATCH **muda `weekday` de um número (0..6) para OUTRO número (0..6)** E a turma, depois do update, está `ACTIVE` com `autoGenerateLessons = true`:
1. **Cancelar** (soft: `status = INACTIVE`, `cancelledAt = agora`) as aulas da turma que satisfazem TODAS as condições: `date >= hoje` (dia civil de São Paulo, `civilTodayStart`), `status = ACTIVE`, **dia da semana civil da aula = o weekday ANTIGO** (mesma convenção do gerador: `getUTCDay()` da `Lesson.date` em meia-noite UTC), **sem nenhuma presença** (`Attendance`), **sem aviso de ausência** (`AttendanceNotice`) e **sem observação** (`notes` nulo ou vazio). Aula criada à mão em outro dia, aula com presença/aviso/observação e aula passada NÃO são tocadas (conta como "mantida" se for do dia antigo, futura e ativa, mas bloqueada por presença/aviso/observação).
2. **Gerar de novo**: depois do cancelamento, executar `ClassLessonsRollingService.ensureHorizon({ classId })` **aguardando** (não fire-and-forget nesse caso) para criar as aulas do dia novo até o horizonte (60 dias); o gerador é idempotente e nunca recria data que já tem aula (inclusive cancelada).
3. **Silencioso**: nenhuma notificação/push é enviada por esse cancelamento automático (como o gerador, que não notifica).
4. **Auditoria**: um `CLASS_UPDATE` já existe; acrescentar no `meta` do mesmo registro `lessonsSync: { cancelled, kept, created, oldWeekday, newWeekday }` (sem dados pessoais).
5. **Não aplicar** quando: `weekday` não mudou; `weekday` passou a `null` ou veio de `null`; a turma ficou `INACTIVE`; `autoGenerateLessons = false` (o dono gerencia as aulas à mão). Nesses casos o comportamento atual continua exatamente igual (inclusive o `queueEnsureHorizon` fire-and-forget de hoje).
6. **Atomicidade e falha**: o cancelamento é um único `updateMany` (por ids pré-selecionados, mesmo `organizationId`); se a geração falhar, o update da turma e o cancelamento permanecem, o erro é logado e `lessonsSync.created` vem `null` (a próxima execução do job diário gera). O PATCH nunca retorna 5xx por causa disso.
7. Concorrência: dois PATCH simultâneos de dia não podem cancelar aulas do dia NOVO (o filtro é sempre o weekday antigo lido do estado anterior à gravação e re-checado no `where` por `date`+dia da semana).

## 2. Resposta
O corpo do PATCH continua sendo o `ClassView` de hoje, **mais** o campo opcional `lessonsSync` **somente quando a regra acima foi aplicada**:
```json
{ "...ClassView": "...", "lessonsSync": { "cancelled": 8, "kept": 1, "created": 9, "oldWeekday": 3, "newWeekday": 4 } }
```
`created` é `number | null` (null = a geração falhou e será feita pelo job). Ausente = nada foi feito. Nenhum outro endpoint muda.

## 3. Painel (tela Turmas, edição da turma)
- Ao **editar** uma turma que tem dia da semana e "Aulas contínuas" ligado, se o campo "Dia da semana" for alterado para outro dia, mostrar **antes de salvar** um aviso discreto no formulário: "Ao salvar, as aulas futuras do dia antigo que não têm presença, aviso de ausência nem observação serão canceladas e novas aulas serão geradas no dia novo."
- Depois de salvar, se a resposta trouxer `lessonsSync`, mostrar um toast/mensagem: "Dia alterado: N aulas do dia antigo canceladas, M geradas no dia novo" + (se `kept > 0`) "K aulas do dia antigo foram mantidas por terem presença, aviso ou observação — revise em Aulas." Se `created` for `null`: "As novas aulas serão geradas automaticamente em breve." Sem `lessonsSync`: comportamento atual.
- Invalidar as consultas de aulas/turmas já usadas pela tela (como o resto do módulo faz) para a lista refletir.
- Não mudar nenhuma outra regra do formulário.

## 4. Testes obrigatórios
- **Backend (unit + e2e, estender `class-lessons-generate.e2e-spec` ou criar spec próprio):** troca de dia cancela só as futuras ativas do dia antigo sem presença/aviso/observação; mantém (e conta `kept`) as com presença, as com aviso, as com observação; não toca passadas, nem canceladas, nem aulas em outros dias criadas à mão, nem aulas do dia novo; gera as do dia novo (`created`) e não duplica; hoje conta como futura; nenhum push/notificação criado; auditoria com `lessonsSync`; casos de não aplicação (weekday igual, para/de `null`, turma INACTIVE, `autoGenerateLessons=false`); falha na geração (simulada) mantém o update e devolve `created: null`; fuso (aula de hoje às 22h SP continua sendo "hoje"); dois PATCH seguidos (quarta→quinta, depois quinta→sexta) deixam só sexta ativa e as quartas/quintas canceladas, sem tocar o que tem presença; isolamento entre grupos.
- **Painel:** aviso aparece só quando o dia muda numa turma com aulas contínuas; mensagens do toast para cada combinação (`kept` 0/>0, `created` número/null); sem `lessonsSync` nada novo.
