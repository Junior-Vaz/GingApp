# Planejamento: Feed do grupo, aniversariantes e comunicação com todo o grupo

Status: **proposta para decisão** (nada implementado). Data: 2026-10-21.

## 1. Objetivo

Hoje o app mostra ao aluno coisas **sobre ele** (corda, frequência, ranking, financeiro). Queremos que ele **faça e veja
coisas do grupo**, e que o gestor tenha ferramentas para manter o grupo vivo:

- **A. Aniversariantes do mês** (gestor): lista, aviso diário, parabéns com um toque.
- **B. Comunicação com todo o grupo** (gestor): um compositor único, com alcance "todo o grupo", agendamento e confirmação.
- **C. Feed do grupo** (todos): fotos, textos, reações e comentários, com moderação.

Ordem recomendada: **A e B primeiro** (valor imediato ao gestor, quase tudo reaproveita o que existe), **C depois**
(é o maior e o que exige mais cuidado com moderação e menores).

## 2. O que já existe e será reaproveitado

| Peça | Situação | Uso |
|---|---|---|
| `Announcement` (comunicados com alcance por turma/UF/papel) e aviso rápido (`POST /notifications/send`, modelos prontos) | existe | base da comunicação (B) |
| `Notification` + push (FCM e Web Push) + sino | existe | entrega de tudo (A, B, C) |
| Notificações de presença com preferência e flag por grupo | existe | padrão de preferências e silenciar |
| `Person.birthDate` / `Student.birthDate` (ficha única) | existe | aniversariantes (A) |
| Jobs (cron diário, fuso de São Paulo, flags dry-run) | existe | aviso diário (A) e agendamento (B) |
| Upload de imagem (`/uploads`, sharp, validação por magic bytes) | existe | fotos do feed (C) |
| Permissões por papel (`@CanAccess`, matriz) e escopo de unidade | existe | quem posta/modera/envia |
| Ranking (Ginga Rank), conquistas, certificados, eventos, rodas | existe | cartões automáticos e pontos no feed |
| Exclusão LGPD / anonimização, auditoria | existe | posts e comentários do titular |

## 3. Parte A — Aniversariantes do mês

**Painel (gestor):**
- Cartão no painel inicial "Aniversariantes do mês" e uma página com a lista do mês (dia, nome, apelido, foto, **idade que faz**,
  turma, unidade, telefone) com filtros por unidade/turma e navegação por mês.
- Botão **"Enviar parabéns"**: notificação no app do aniversariante (texto editável, com modelos) e atalho de **WhatsApp**
  com mensagem pronta (`wa.me`, sem API paga).
- **Aviso diário ao gestor** (cron ~07:30 SP): "Hoje: 3 aniversariantes (Fulano, Beltrano...)", só se houver.
- **Parabéns automáticos** (opcional, por grupo): liga/desliga; mensagem editável; envia no dia, no horário escolhido.

**App (aluno):**
- Faixa "Aniversariantes da semana" na Home/feed; toque em **"Parabenizar"** manda uma notificação ao aniversariante
  (com limite de 1 por pessoa). Pode virar um cartão automático no feed.

**Regras e privacidade (LGPD):**
- Mostrar **só dia e mês** a alunos; a **idade** só para o gestor.
- **Menores de 18**: nunca expor foto/idade/data a outros alunos; aparecem só para a equipe; o parabéns público segue
  a regra do feed (sem foto sem autorização).
- **Opt-out**: o aluno (ou o responsável) pode escolher "não mostrar meu aniversário ao grupo" (o gestor continua vendo).
- Quem tem matrícula em vários grupos aparece em cada grupo ativo; a equipe também.
- 29/02 em ano não bissexto comemora em 28/02. Fuso: America/Sao_Paulo.

**Dados:** sem tabela nova para a lista (consulta por mês/dia sobre `Person.birthDate`, índice em mês/dia); preferência
`birthdayVisible` na ficha/matrícula; configuração do grupo (`birthdayAutoGreeting`, mensagem, horário); registro do parabéns
enviado (evita duplicar no mesmo ano).

## 4. Parte B — Comunicação com todo o grupo

Hoje há comunicados com alcance e o aviso rápido. Falta um **compositor único** e algumas peças:

- **Compositor "Comunicar"** no painel: título, mensagem, imagem opcional e **alcance**: *todo o grupo*, unidade, turma,
  papel (alunos, responsáveis, equipe), *aniversariantes do mês*.
- **Agendamento**: enviar agora ou em data/hora (cron a cada minuto sobre os agendados).
- **Confirmação de um toque** ("Vou" / "Li e entendi"), com contagem para o gestor (ex.: "42 confirmaram, 18 pendentes").
- **Histórico e alcance**: enviados, entregues, lidos, confirmados; reenviar só para quem não leu.
- **Fixar no feed**: o comunicado pode aparecer fixo no topo do feed (C).
- **Modelos** já existem (aviso rápido); estender para o compositor.
- **Quotas e antispam**: limite diário por grupo e por autor; aviso antes de enviar a "todos" com a contagem de destinatários
  e confirmação ("Enviar para 214 pessoas?").
- **Preferências do usuário**: respeitar silenciar e horário de silêncio; push de emergência só para a equipe.
- **Permissões**: Mestre para todo o grupo; Professor/Instrutor só para as turmas deles.

**Dados:** estender `Announcement` (alcance "todo o grupo", `scheduledAt`, `requiresAck`, `pinnedUntil`) e uma tabela de
confirmações (`AnnouncementAck`: anúncio, usuário, tipo, data); leitura já existe em `Notification`.

## 5. Parte C — Feed do grupo

**O que é:** uma linha do tempo do **grupo** (não é rede social aberta): só membros do grupo veem. Alunos e equipe postam
**fotos e texto**, reagem e comentam. O gestor modera.

**Funcionalidades F1:**
- Postar: texto + até 6 fotos (reaproveita upload, sharp e remoção de EXIF/GPS), escolha de **visibilidade**
  (todo o grupo / minha unidade / minha turma).
- **Reações temáticas** (um toque): *Axé* 🔥, *Salve* 👏, *Ginga* 🥋, *Parabéns* 🎉, *Coração* ❤️ — uma por pessoa por post,
  trocável.
- **Comentários** (um nível de resposta), editar/apagar o próprio.
- **Fixar** (gestor), **ocultar/remover** (gestor e autor), **denunciar** (qualquer um) com fila de moderação no painel.
- **Cartões automáticos** (gerados por regra, opcionais por grupo): aniversariantes, roda confirmada, evento novo,
  "subiu de corda" (com consentimento do aluno), conquistas.
- **Notificações agrupadas**: "Fulano e mais 3 reagiram ao seu post" (não uma por reação).
- **Paginação por cursor**, atualização por *puxar para recarregar* e atualização leve ao voltar ao app (sem WebSocket na F1).

**Moderação e segurança (o ponto mais importante):**
- **Quem pode postar** é configuração do grupo: todos / só equipe / alunos com **aprovação** (modo moderado).
- **Menores**: foto de menor só com autorização de imagem do responsável (reusar o consentimento de imagem dos formulários
  e da ficha); sem mensagens diretas entre alunos; sem busca pública.
- Texto **sempre texto puro** (nada de HTML); links sanitizados (`rel="noopener noreferrer nofollow"`); sem pré-visualização
  que baixe conteúdo de terceiros no servidor.
- Limites: posts/dia por usuário, tamanho, número e peso de fotos; filtro opcional de palavras bloqueadas.
- **LGPD**: exclusão e anonimização do titular alcançam posts, comentários e reações; retenção configurável; auditoria
  de remoções de moderação.
- **IDOR/isolamento**: tudo filtrado por grupo (e unidade/turma conforme a visibilidade); mídia servida com autenticação
  ou URL assinada de curta duração (as fotos do feed **não** ficam em pasta pública sem controle).

**Engajamento sem exagero:** pontos do Ginga Rank por postar em desafios (limitados por dia), "foto do treino" como
desafio mensal. Nada de curtida competitiva entre alunos.

**Dados (resumo):** `FeedPost` (grupo, autor, texto, tipo, visibilidade, unidade/turma, fixado, status
PUBLICADO/OCULTO/REMOVIDO/AGUARDANDO_APROVACAO), `FeedPostMedia`, `FeedReaction` (post/comentário, usuário, tipo; único por
usuário+alvo), `FeedComment`, `FeedReport` (alvo, denunciante, motivo, status), configuração do grupo
(`feedPostingMode`, `feedEnabled`).

**Endpoints (resumo):** `GET /feed` (cursor), `POST /feed/posts`, `DELETE /feed/posts/:id`, `PUT /feed/posts/:id/reaction`,
`POST /feed/posts/:id/comments`, `POST /feed/posts/:id/report`; no painel: moderação (`/feed/moderation`), fixar, aprovar,
configurações do feed.

## 6. Fases e esforço relativo

| Fase | Entrega | Esforço |
|---|---|---|
| **F1a – Aniversariantes + Comunicar** | Lista/cartão do mês, aviso diário ao gestor, parabéns manual e WhatsApp, opt-out; compositor "Comunicar" com "todo o grupo", agendamento, confirmação de um toque, histórico/alcance, quotas | **M** |
| **F1b – Feed MVP** | Postar texto+fotos, visibilidade, reações temáticas, comentários, fixar/ocultar/denunciar, moderação no painel, modo moderado, notificações agrupadas, configurações do grupo | **G** |
| **F2** | Parabéns automáticos, cartões automáticos (aniversário, roda, conquista), pontos/desafio "foto do treino", menções, vídeo curto | M |
| **F3** | Tempo real (WebSocket/SSE), enquetes no feed, álbuns de evento, destaques semanais | M |

Cada fase fecha com o **gate** de sempre (lint, tsc, testes, build; backend `test:quick`) e **auditoria adversarial**
(F1b em especial: conteúdo de usuário, imagens de menores, moderação, IDOR).

## 7. Testes (simples e rápidos)

- Backend e2e curtos: aniversariantes (mês/dia, 29/02, menores, opt-out, vários grupos), cron diário (dry-run), quotas
  de comunicação, alcance "todo o grupo", agendamento, confirmação; feed (postar, visibilidade por grupo/unidade/turma,
  reação única por usuário, comentário, denúncia, ocultar, modo moderado, isolamento entre grupos, permissões,
  exclusão LGPD, mídia só autenticada).
- Painel/app: telas e fluxos principais com API mockada, e conferência visual a 375 px.

## 8. Decisões em aberto (preciso da sua resposta)

1. **Quem pode postar no feed por padrão**: todos os membros, só a equipe, ou alunos com aprovação do professor?
   (Recomendo: *alunos com aprovação* nos primeiros 30 dias e depois configurável por grupo.)
2. **Moderação**: depois de publicar (denúncia) ou antes (aprovação)? (Recomendo: pós-moderação + denúncia, e aprovação
   obrigatória para menores.)
3. **Fotos de menores**: só com autorização de imagem do responsável? (Recomendo: sim, e sem foto de menor para quem é
   de fora do grupo.)
4. **Vídeo curto** já na F1b ou só na F2? (Recomendo F2: custo de armazenamento, transcodificação e moderação.)
5. **Parabéns**: automáticos por padrão ou só manuais? (Recomendo: manuais na F1a, automáticos opcionais na F2.)
6. **Aniversário visível ao grupo** por padrão ou só ao gestor até o aluno aceitar? (Recomendo: dia/mês visível ao grupo
   para adultos, com opt-out; menores só a equipe.)
7. **WhatsApp**: só atalho `wa.me` (grátis, manual) ou integração oficial paga? (Recomendo: atalho.)
8. **Reações**: as 5 temáticas propostas estão boas, ou prefere outras (ex.: *Mandinga*, *Salve Mestre*)?

## 9. Riscos

- **Conteúdo de usuário** (ofensas, fotos impróprias, bullying): mitigado por denúncia, moderação, modo moderado e limites.
- **Menores**: exige autorização de imagem e visibilidade restrita; erro aqui é o mais grave.
- **Spam de notificações** (comunicados e reações): quotas, agrupamento, silenciar.
- **Custo de armazenamento de fotos**: limite por grupo e por post, compressão e retenção.
- **Escopo inflando**: manter a F1b só foto+texto+reação+comentário.

## 10. Critérios de aceite

**F1a:** o gestor vê os aniversariantes do mês com idade, envia parabéns pelo app e por WhatsApp, recebe o aviso diário;
menores e opt-out respeitados; o compositor envia para "todo o grupo" com confirmação de quantidade, agenda um envio e
mostra quem confirmou.
**F1b:** um aluno posta uma foto, outro reage e comenta e o autor é notificado de forma agrupada; o gestor fixa, oculta e
trata uma denúncia; fotos só aparecem autenticadas; um post de outro grupo nunca é visível; testes e gate verdes.
