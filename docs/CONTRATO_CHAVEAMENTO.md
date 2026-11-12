# CONTRATO — Chaveamento de campeonato ao vivo (Frente "Campeonatos", fase 1)

Estado: **contrato aprovado pelo dono em 2026-11-09** (formatos da fase 1, SSE com plano B de consulta, regra de menores).
Fonte da verdade para backend, painel e app. Mudou o desenho? Mude AQUI primeiro, depois o código.

## 0. Decisões do dono (não reabrir)
1. **Formatos da fase 1:** eliminatória simples (com folgas/bye e disputa de 3º lugar opcional), todos contra todos, fase de grupos + mata-mata. Dupla eliminação, repescagem e suíço = fase 2 (o enum e o motor já ficam preparados).
2. **Tempo real:** SSE; plano B = consulta a cada 3 s com ETag. Sem WebSocket.
3. **Menores no telão público:** nome + grupo; **foto só com autorização** registrada.
4. Atletas de dentro (aluno) e de fora (convidado) entram na mesma chave. Quem opera é a equipe (papéis com `events` edit).

## 1. Escopo e limites
- Um **Torneio** por Evento (`Event.type = 'CAMPEONATO'`, senão 400 `EVENT_NOT_TOURNAMENT`). O torneio tem várias **Categorias** (ex.: "Adulto masc. até 70 kg"); cada categoria tem seu formato, seus atletas e suas lutas.
- Limites: até 40 categorias por torneio; 2..128 atletas por categoria; grupos: `groupCount` 2..16, `advancePerGroup` 1..4, e `groupCount*advancePerGroup >= 2`.
- Fora de escopo (fase 2+): dupla eliminação, repescagem, suíço, arrastar-e-soltar, vários árbitros/placar por rounds, impressão da chave em PDF, Pix/inscrição paga, cascata de desfazer.

## 2. Modelo de dados (migration `20261110000000_tournaments`, escrita à mão, sem BOM)
Enums novos: `TournamentFormat {SINGLE_ELIMINATION, ROUND_ROBIN, GROUPS_KNOCKOUT}` (fase 2 faz `ADD VALUE` em migration SEPARADA), `TournamentCategoryStatus {SETUP, RUNNING, FINISHED}`, `TournamentMatchStage {GROUP, MAIN, THIRD_PLACE}`, `TournamentMatchStatus {PENDING, READY, LIVE, FINISHED}`, `TournamentResultType {NORMAL, WALKOVER, DISQUALIFICATION, DRAW}`, `TournamentAgeGroup {ADULT, MINOR, UNKNOWN}`.

Tabelas (todas com `organizationId` e índice nele; nomes Prisma `Tournament*`):
- **Tournament**: `id`, `organizationId`, `eventId` **único**, `publicToken` único (24+ chars aleatórios, URL-safe, `crypto.randomBytes`), `publicEnabled` bool default false, `revision` int default 0 (sobe a cada mutação), `createdAt`, `updatedAt`.
- **TournamentCategory**: `id`, `organizationId`, `tournamentId`, `name` (1..80), `position` int, `format`, `status` default SETUP, `thirdPlace` bool default false, `groupCount` int?, `advancePerGroup` int?, `drawSeed` int? (semente do sorteio, torna o sorteio reprodutível), `generatedAt`?, `createdAt`, `updatedAt`. Único `(tournamentId, name)` (case-insensitive via `lower(name)` em índice).
- **TournamentCompetitor**: `id`, `organizationId`, `categoryId`, `displayName` (2..80), `groupName` (academia/grupo, 0..80)?, `graduationLabel` (0..60)?, `seed` int? (1 = cabeça de chave), `poolIndex` int? (preenchido ao gerar grupos), `studentId`? , `eventParticipantId`?, `photoUrl`? (só para convidado; SEMPRE `/api/uploads/<uuid>` ou `https://`), `ageGroup` default UNKNOWN, `photoAuthorized` bool default false, `photoAuthorizedById`?, `photoAuthorizedAt`?, `createdAt`. Únicos parciais: `(categoryId, studentId)` quando não nulo; `(categoryId, eventParticipantId)` quando não nulo.
- **TournamentMatch**: `id`, `organizationId`, `categoryId`, `key` (string estável, ex. `MAIN-1-0`, `GROUP-0-2-1`, `THIRD_PLACE-1-0`; único por categoria), `stage`, `round` (1-based), `position` (0-based na rodada), `groupIndex`?, `slotAId`?, `slotBId`? (FK competitor), `nextMatchId`?, `nextSlot` ('A'|'B')?, `loserNextMatchId`?, `loserNextSlot`?, `isBye` bool, `status`, `winnerId`?, `scoreA`?, `scoreB`? (0..999), `resultType`?, `note` (0..200)?, `mat` (tatame, 0..40)?, `queueOrder` int?, `startedAt`?, `finishedAt`?, `createdAt`, `updatedAt`.
- `Student.photo` continua sendo a foto do aluno; o atleta ligado a aluno **deriva a foto do aluno em tempo de leitura** (não copia).

## 3. Motor de chaveamento (funções PURAS, sem Prisma) — `backend/src/interface/http/tournaments/engine/`
Tipos fixos em `engine/types.ts` (já escrito junto deste contrato; **não alterar sem atualizar o contrato**). Funções:
1. `generateSingleElimination(competitors, opts) -> MatchSpec[]` — chave de tamanho `P = próxima potência de 2 >= N`. Posicionamento padrão de sementes (1 vs P, 2 vs P-1 …, cabeças de chave só se encontram o mais tarde possível). `P-N` folgas (bye) vão para as MELHORES sementes; nunca bye contra bye; folga só na rodada 1. Matches de bye já nascem `isBye=true, winnerId` definido e o vencedor já colocado no slot da próxima luta. `thirdPlace` cria `THIRD_PLACE-<última rodada>-0` ligado por `loserNext` às duas semifinais (só se N >= 4). Seeding: `RANDOM` (sorteio com `rngSeed`), `BY_SEED` (sementes informadas; sem semente vão ao fim, em ordem de sorteio), `AVOID_SAME_GROUP` (sorteio que evita mesmo `groupName` na rodada 1 quando for possível; melhor esforço determinístico).
2. `generateRoundRobin(competitors, opts) -> MatchSpec[]` — método do círculo; N(N-1)/2 lutas, cada atleta no máximo 1 luta por rodada; `stage=GROUP`, `groupIndex=0`.
3. `generateGroups(competitors, opts) -> { groups: Id[][]; matches: MatchSpec[] }` — distribuição "serpentina" por semente, grupos com tamanhos que diferem em no máximo 1; cada grupo é um todos-contra-todos (`groupIndex` = índice do grupo).
4. `computeStandings(ids, results, rules) -> StandingRow[]` — vitória 3 / empate 1 / derrota 0 (W.O. e desclassificação contam vitória para o adversário, sem pontos de saldo); desempate: pontos → vitórias → saldo (pró-contra) → pró → confronto direto (só entre exatamente 2 empatados) → menor `seed`/ordem de cadastro. Determinístico.
5. `buildKnockoutFromGroups(orderedGroups, opts) -> MatchSpec[]` — classificados = `advancePerGroup` primeiros de cada grupo; cruzamento tipo 1ºA×2ºB (1ºs ficam em lados opostos, mesmo grupo só se encontra o mais tarde possível); reutiliza `generateSingleElimination` com semente = (colocação no grupo, índice do grupo).
6. `resolveAdvancement(match, outcome) -> SlotUpdate[]` — vencedor vai para `next`, perdedor para `loserNext` (se houver).
7. `computePodium(format, matches, standings) -> PodiumEntry[]` — 1º/2º/3º(/3º empatado quando não há disputa de 3º: os dois perdedores das semifinais).

Propriedades obrigatórias (testes de propriedade, N = 2..64 e 100, 128, com várias sementes de RNG): total de lutas = N−1 (+1 com 3º lugar); todo atleta aparece exatamente 1 vez na rodada 1 (ou numa folga); nenhuma luta tem o mesmo atleta nos dois lados; toda luta (exceto a final e a de 3º) tem `next`; pontas conectadas formam uma árvore única; folgas só na rodada 1 e só para as melhores sementes; com `AVOID_SAME_GROUP` e grupos "viáveis" (nenhum grupo com mais de ⌈N/2⌉ atletas) ninguém enfrenta o mesmo grupo na rodada 1; mesma `rngSeed` ⇒ mesma chave; RR: cada par exatamente 1 vez.

## 4. API do operador (JWT; `organizationId` SEMPRE do token)
Prefixo `/api/events/:eventId/tournament`. Leitura = `@CanAccess('events','view')`; escrita = `@CanAccess('events','edit')` **e** staff (MESTRE/PROFESSOR/INSTRUTOR); MONITOR só lê; ALUNO/RESPONSAVEL = 403.
| Método e rota | Efeito |
|---|---|
| `GET /` | Torneio + categorias (resumo: contagens, status) — 404 `TOURNAMENT_NOT_FOUND` se não existe |
| `POST /` | Cria o torneio do evento (201); já existe → 409 `TOURNAMENT_EXISTS` |
| `PATCH /` `{publicEnabled}` | Liga/desliga o telão público |
| `POST /rotate-token` | Gera novo `publicToken` (o antigo morre na hora; streams abertos recebem `closed`) |
| `POST /categories` `{name, format, thirdPlace?, groupCount?, advancePerGroup?}` | Cria categoria |
| `PATCH /categories/:cid` | Edita (só em SETUP, exceto `name`); `DELETE /categories/:cid` (só SETUP, ou RUNNING sem resultado) |
| `GET /categories/:cid` | Categoria completa: atletas (visão do operador, com `ageGroup`, `photoAuthorized`, `studentId`…), lutas, classificação, pódio |
| `POST /categories/:cid/competitors` | corpo é UMA destas formas: `{eventParticipantId}` · `{studentId}` · `{guest:{displayName, groupName?, graduationLabel?, ageGroup?, photoUrl?}}`; só em SETUP |
| `POST /categories/:cid/competitors/from-participants` `{eventParticipantIds:number[]}` | Importa em lote (ignora já existentes, devolve `{added, skipped}`) |
| `PATCH /competitors/:id` `{displayName?, groupName?, graduationLabel?, seed?, ageGroup?, photoAuthorized?, photoUrl?}` | Edita; `displayName/groupName/graduationLabel/photoAuthorized/ageGroup/photoUrl` valem a qualquer momento (corrigir grafia no meio do evento); `seed` só em SETUP. Marcar `photoAuthorized=true` grava `photoAuthorizedById/At` |
| `DELETE /competitors/:id` | Só em SETUP |
| `POST /categories/:cid/generate` `{seeding, regenerate?}` | Gera a chave/grupos. SETUP → RUNNING. Já gerada: só com `regenerate:true` **e** nenhuma luta LIVE/FINISHED (senão 409 `HAS_RESULTS`). Mínimo 2 atletas (`NOT_ENOUGH_COMPETITORS`) |
| `PATCH /matches/:mid/slots` `{slotAId, slotBId}` | Troca atletas de lugar na 1ª rodada antes de qualquer resultado da categoria (`SWAP_NOT_ALLOWED` senão); os dois ids precisam ser atletas da categoria; troca sem duplicar |
| `POST /matches/:mid/start` | READY → LIVE (várias lutas LIVE ao mesmo tempo são permitidas: tatames) |
| `POST /matches/:mid/result` `{winnerId?, scoreA?, scoreB?, resultType?, note?}` | Fecha a luta e **propaga** vencedor/perdedor. `DRAW` só em GROUP (sem `winnerId`); mata-mata exige `winnerId` ∈ {slotA, slotB}. Repetir o MESMO resultado = 200 sem mudança; resultado diferente em luta FINISHED = 409 `MATCH_ALREADY_FINISHED` (desfaça antes). Luta sem os dois atletas = 409 `MATCH_NOT_READY` |
| `POST /matches/:mid/undo` | Desfaz LIVE→READY ou FINISHED→READY, tirando o vencedor/perdedor dos slots seguintes. Bloqueado se a luta seguinte já está LIVE/FINISHED: 409 `DEPENDENT_MATCH_PLAYED` (desfaça na ordem inversa). Em GROUPS_KNOCKOUT: se o mata-mata já foi gerado, só desfaz se NENHUMA luta dele está LIVE/FINISHED — nesse caso o mata-mata é apagado e será regerado quando o último jogo de grupo terminar |
| `PATCH /matches/:mid` `{mat?, queueOrder?}` | Tatame e ordem de chamada |
Regras: toda mutação roda em UMA transação com trava na linha da categoria (`SELECT … FOR UPDATE`), incrementa `Tournament.revision` e grava auditoria (`TOURNAMENT_*`, sem dados pessoais além de ids) — **só depois do commit** é que o hub SSE é notificado. Último jogo de grupo terminado ⇒ gera o mata-mata automaticamente (na mesma transação). Todas as lutas terminadas ⇒ categoria FINISHED. Respostas de mutação devolvem a categoria completa (mesmo formato do `GET /categories/:cid`).
Erros: sempre `{statusCode, message, code}` com os `code` em MAIÚSCULAS acima.

## 5. API pública do telão (SEM login)
- `GET /api/public/tournaments/:token` → snapshot público (abaixo). Cabeçalhos: `ETag: "<revision>-<hash10 do conteúdo>"` (opaco para o cliente; o hash existe porque foto/nascimento do aluno mudam o snapshot SEM mutação, e um ETag só por revisão deixaria o 304 preso mostrando a foto de um menor — decisão registrada após a implementação), `Cache-Control: no-cache`, `X-Robots-Tag: noindex`; `If-None-Match` igual → **304**. Token desconhecido, torneio com `publicEnabled=false`, evento DRAFT/CANCELLED ou evento há mais de **30 dias** (`PUBLIC_VIEW_DAYS_AFTER_EVENT`) → **404 idêntico** (nunca revelar qual dos casos).
- `GET /api/public/tournaments/:token/stream` → `text/event-stream`. Ao conectar envia `event: snapshot` com o snapshot completo (`id:` = revision); a cada mutação envia outro `snapshot` (estado completo, não delta; assim reconectar é trivial). `: ping` a cada 20 s. Cabeçalhos `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Encerra com `event: closed` quando o token é rotacionado/desligado, e por tempo máximo de 6 h. Limite de 300 conexões simultâneas por torneio (excedeu → 503 `TOO_MANY_VIEWERS`).
- **Limites:** o IP do wi-fi do ginásio é único para centenas de pessoas. Throttle próprio e alto para estas duas rotas (env `TOURNAMENT_PUBLIC_THROTTLE_LIMIT`, default **6000**/min — o plano B de 3 s custa 20 req/min por tela, então 1200 só comportaria 60 telas atrás do mesmo IP; abrir conexão SSE 120/min por IP). **Não há limite de conexões por IP** no hub (centenas de pessoas dividem o IP do wi-fi); o teto é por torneio (`TOURNAMENT_MAX_VIEWERS`, default 300, ajustável), e o snapshot é **memoizado por (tournamentId, revision)** — N espectadores = 1 consulta ao banco por mudança.
- **Hub SSE em memória** (uma instância do backend). Multi-instância exigiria Redis pub/sub: registrar como limitação no plano.
- **Snapshot público (formato exato):**
```json
{
  "revision": 12,
  "serverTime": "2026-11-20T15:04:05.000Z",
  "event": { "title": "...", "date": "ISO", "location": "..."|null, "imageUrl": "..."|null },
  "organizationName": "...",
  "categories": [{
    "id": 1, "name": "...", "format": "SINGLE_ELIMINATION", "status": "RUNNING", "thirdPlace": true,
    "competitors": [{ "id": 1, "name": "...", "group": "..."|null, "graduation": "..."|null, "photoUrl": "/api/uploads/<uuid>"|null, "seed": 1|null, "poolIndex": null }],
    "matches": [{ "id": 1, "key": "MAIN-1-0", "stage": "MAIN", "round": 1, "position": 0, "groupIndex": null,
      "slotAId": 1|null, "slotBId": 2|null, "nextMatchId": 9|null, "nextSlot": "A"|null, "isBye": false,
      "status": "LIVE", "winnerId": null, "scoreA": null, "scoreB": null, "resultType": null, "mat": "1"|null, "queueOrder": 3|null }],
    "standings": [{ "groupIndex": 0, "rows": [{ "competitorId": 1, "played": 2, "wins": 1, "draws": 0, "losses": 1, "pointsFor": 4, "pointsAgainst": 3, "points": 3, "rank": 1 }] }],
    "podium": [{ "place": 1, "competitorId": 1 }]
  }]
}
```
**Nunca** entram no público: `studentId`, `eventParticipantId`, `ageGroup`, `photoAuthorized*`, `birthDate`, e-mail, telefone, `note`, `organizationId`, `publicToken`, dados de responsável. `photoUrl` público **somente se** (`ageGroup=ADULT`) **ou** (`photoAuthorized=true`); `MINOR` e `UNKNOWN` sem autorização ⇒ `null`. `ageGroup` de atleta ligado a aluno é recalculado da data de nascimento do aluno/pessoa com o helper existente (`isMinorOn`/`feed-minor.ts` — reutilizar, não duplicar); sem data ⇒ `UNKNOWN`. Atleta convidado: o operador informa.
- Rotas GET públicas novas entram na `MEMBER_ALLOWLIST` de `backend/test/member-privacy.e2e-spec.ts` com justificativa (são `@Public`).

## 6. Painel (operador) — `painel.gingapp.com.br`
- Rota nova `/eventos/$id/chaveamento` (arquivo plano `_app.eventos_.$id.chaveamento.tsx` ou equivalente do roteador), acessada por botão "Chaveamento" na linha de eventos de tipo CAMPEONATO. Sem item novo no menu.
- Telas: (1) **Torneio**: criar; link/QR do telão, ligar/desligar, "gerar novo link". (2) **Categorias** (abas): criar/editar; lista de atletas com "Adicionar do evento" (importar participantes confirmados), "Adicionar aluno", "Adicionar de fora" (nome, grupo, graduação, maior/menor de idade, foto opcional); campo **"Tenho autorização do responsável para exibir a foto"** (só quando não ADULT). (3) **Sorteio**: escolha de sorteio (aleatório / por sementes / evitar mesmo grupo), 3º lugar, nº de grupos; "Gerar chave". (4) **Chave ao vivo**: SVG por colunas de rodada com conectores; tocar numa luta abre painel com "Iniciar", "Vencedor A/B", placar, tipo (normal/W.O./desclassificação/empate nos grupos), tatame, "Desfazer" — mensagens claras para cada `code` de erro; troca de atletas na 1ª rodada tocando em dois lugares (sem arrastar); classificação ao vivo para grupos/todos-contra-todos; consulta a cada 5 s + invalidação após cada mutação.
- Estados: carregando (skeleton), vazio, erro com tentar de novo, mobile (operador usa celular no ginásio): botões grandes, painel de luta como bottom sheet.
- Sem dependências novas além do que o painel já tem.

## 7. App (telão público) — `app.gingapp.com.br`
- Rota pública `/ao-vivo/$token` fora do `_app` (sem login), `noindex`. Query `?tv=1` liga o modo telão; `?categoria=<id>` abre numa categoria e `?q=<texto>` pré-busca um atleta ou grupo (links profundos, só no modo normal; id inexistente é ignorado; o painel pode gerar `…/ao-vivo/<token>?categoria=<id>`).
- **Conexão:** `EventSource` no `/stream`; se cair ou não abrir em 8 s, cai para consulta a cada 3 s com `If-None-Match`, e tenta reabrir o SSE a cada 30 s. Indicador "AO VIVO / reconectando…". 404 ⇒ tela "Este campeonato não está disponível" (sem detalhes).
- **`closed` (decisão pós-implementação):** os motivos `max-duration` (teto de 6 h) e `shutdown` (reinício do servidor) são PASSAGEIROS: o telão cai para a consulta e reabre o SSE (um campeonato dura mais de 6 h); se a consulta responder 404, vira "indisponível". `token-rotated`, `disabled`, `unavailable` e motivo desconhecido/ilegível = "indisponível" sem reconectar. A tela nunca mostra o motivo. O navegador não expõe o status HTTP do `EventSource` nem o `: ping`, então o 404/503 do `/stream` só aparece como erro e o 404 real vem da consulta GET.
- **Visual:** chave horizontal em SVG que se ajusta à tela; cartões de atleta com avatar (iniciais coloridas quando `photoUrl` é nulo), nome, grupo e graduação; luta LIVE destacada com pulso; faixa "AGORA no tatame N" e "PRÓXIMAS" com avatares grandes; abas/rodízio automático de categorias no modo `tv=1` (prioriza categorias com luta LIVE; troca a cada 20 s caso contrário); classificação para grupos/todos-contra-todos; pódio com confete ao terminar a categoria.
- **Animação:** ao chegar um snapshot em que uma luta virou FINISHED, anima o vencedor "correndo" pela linha até o próximo cartão (stroke-dashoffset + deslocamento do cartão). Dependência nova permitida no app: `motion` (framer-motion) com versão fixa; **respeitar `prefers-reduced-motion`** (sem movimento, só destaque). Botão de tela cheia e `navigator.wakeLock` (com try/catch). QR do link opcional.
- Nenhum dado além do snapshot público; nada de `localStorage` crítico.

## 8. Testes e gate
- Backend: unit do motor (propriedades da §3) + e2e HTTP real do fluxo completo (cada formato do início ao pódio), isolamento entre organizações, papéis (MONITOR/ALUNO não escrevem), concorrência (dois resultados ao mesmo tempo na mesma luta ⇒ um vence, outro idempotente/409), `undo` com todas as regras, **SSE de verdade** (abrir o stream por HTTP, receber o primeiro `snapshot`, mutar, receber o seguinte; rotacionar token ⇒ `closed`), 304 por ETag, e **prova de privacidade com sentinelas** (menor sem autorização ⇒ `photoUrl:null` no snapshot, no SSE e em NENHUMA resposta pública; nenhum campo proibido da §5 aparece; nem nos logs).
- Fixtures reais: o e2e captura o JSON real (`TOURNAMENT_CAPTURE_DIR`) → `real-contract-chaveamento.ts` no painel e no app, com teste de conformidade nos dois (chaves exatas que cada front lê).
- Painel: testes dos fluxos (criar, adicionar, gerar, resultado, desfazer, erros). App: testes do reducer de snapshot (diff de lutas FINISHED), fallback SSE→polling, regra de foto nula, reduced-motion.
- Um gate completo rodado por mim: painel (lint/tsc/build/vitest), app, admin, backend (build + unit + quick + bootstrap). Commit por caminho; plano `PLANO_PROJETO.md` §10.96.

## 8b. Ajustes pós-revisão adversarial (2026-11-10)
- Resultado em luta de folga (`isBye`) = 409 `MATCH_IS_BYE`. `PATCH /competitors/:id` com `ageGroup` em atleta ligado a aluno = 400 `AGE_GROUP_FROM_STUDENT` (a faixa etária é derivada do cadastro); `photoUrl` nesse caso = 400 `INVALID_PHOTO_URL`.
- Cache negativo de 404 público (TTL ~5 s), invalidado ao rotacionar/ligar/criar; época de memoização por torneio; frame SSE memoizado; ouvintes do SSE nunca vazam se o cliente cai antes do stream abrir.
- Riscos ACEITOS (pendências): foto de convidado aceita qualquer host `https`; FK composta entre categorias (a API valida, o banco não); nome de aluno apagado (`ON DELETE SET NULL`) permanece no telão como "convidado"; dado externo (evento cancelado, aluno anonimizado) leva até ~30 s para sair do telão (TTL 10 s + ping 20 s).

## 9. Implantação / limitações conhecidas (registrar no plano)
Migration nova (`prisma migrate deploy`); imagens backend, painel e app. SSE em memória = uma instância. Sem lock entre dois operadores além da trava de linha. Não vimos o proxy de produção: a resposta traz `X-Accel-Buffering: no` e `ping` a cada 20 s, mas só o teste real em produção confirma. Autorização de imagem é um campo marcado pela equipe (não há documento anexado). Dados do torneio não são apagados automaticamente após o evento (pendência: retenção/anonimização).
