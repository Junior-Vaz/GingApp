# Plano — Sustentar a plataforma gratuita: patrocinadores no banner e apoio voluntário com prestação de contas

Status: **proposta para decisão do dono (nada construído).** Objetivo: o GingApp continua **gratuito para todo capoeirista**, sem mensalidade, e se
sustenta por duas frentes que não cobram o aluno: (A) **patrocinadores** num slide do banner da Home e (B) **apoio voluntário** com **prestação de contas
pública**. As duas se reforçam: a transparência dá confiança para apoiar e para patrocinar; apoiadores podem optar por não ver patrocinadores.

Esta é uma visão de produto e engenharia, **não consultoria jurídica, contábil ou financeira**: contrato com patrocinador, tributação, forma jurídica
(associação ou empresa) e regras de publicidade/LGPD precisam ser validados com advogado e contador antes de cobrar.

## 0. Pontos de partida no código (reaproveitar, não reinventar)
- O banner da Home é o carrossel `HeroCarouselView` (`app/.../hero-carousel.tsx`: slides comunidade, ranking, jornada, check-in; autoplay 5,5 s, pausa
  com toque/foco, `prefers-reduced-motion` sem autoplay). Um patrocinador é **um slide novo** (`tone: "sponsor"`).
- Já existem: anúncios da plataforma (`PlatformAnnouncement`) e o painel **admin (Vue)** da equipe da plataforma; upload de imagem com reprocessamento
  (sharp); pagamentos Pix/Mercado Pago com webhook e conciliação (hoje por grupo, com token do Mestre); auditoria; ranking e conquistas; motor de planos
  (Fase 2) hoje dormente; páginas públicas (inscrição) e privacidade/LGPD (consentimentos, anonimização).

## FRENTE A — Patrocinadores no banner ("Parceiros da roda")

### A1. Experiência
- Um slide de patrocinador no carrossel da Home, **sempre rotulado "Patrocinado"**, com logo, frase curta (até ~90 caracteres), imagem leve e um botão
  ("Conhecer"). No máximo **1 slide de patrocinador por vez** e fora da primeira posição (ex.: 3º de 5), para não ser a primeira coisa que o aluno vê.
- Toque abre o site do patrocinador numa nova aba (`rel="sponsored noopener noreferrer"`) passando por um redirecionador nosso que só conta o clique.
- "Por que estou vendo isso?" abre uma folha: "O GingApp é gratuito e se mantém com apoio de parceiros e de pessoas como você" + link para a
  **transparência** (Frente B) e para "Apoiar o GingApp". **Amigos da Roda (apoiadores) podem escolher não ver patrocinadores.**
- Rotação ponderada entre campanhas ativas; o mesmo aparelho não vê a mesma campanha mais de N vezes por dia.

### A2. Regras de ouro (ética, crianças, LGPD)
- **Sem rastreamento:** nada de cookies/scripts/pixels de terceiros, nada de perfil comportamental, nada de ID de usuário nas métricas. Segmentação só
  **por região** (UF/cidade da unidade do grupo), nunca por pessoa.
- **Menores:** não mostrar patrocinador quando quem usa o app é menor de 18 anos (conta de aluno menor); no app de um responsável também não quando o
  perfil ativo é um dependente menor. Pelo que sei, a LGPD (art. 14) e o ECA Digital (Lei 15.211/2025) restringem fortemente publicidade e perfilamento
  de crianças e adolescentes: **o advogado confirma** antes de ligar para qualquer público menor.
- **Categorias permitidas (lista branca):** instrumentos e artigos de capoeira, vestuário/abadá, saúde (fisio, nutrição, clínicas), educação e cursos,
  eventos e turismo cultural, alimentação saudável, academias/esportes. **Proibidas:** bebidas alcoólicas, apostas/bets, tabaco, conteúdo adulto,
  crédito/consignado predatório, política partidária, qualquer coisa fora da lista sem aprovação.
- **Identificação clara** como publicidade (selo "Patrocinado"), sem imitar notificação, post de aluno ou mensagem do Mestre.
- **Aprovação humana** de cada campanha (texto, imagem e destino) antes de ir ao ar; direito de pausar/remover na hora.
- Nunca vender dados. Nunca expor lista de usuários ao patrocinador; relatório só agregado.

### A3. Modelo de dados (novas tabelas, sem dado pessoal)
- `Sponsor` (nome, logo, contato comercial, documento fiscal opcional, observações).
- `SponsorCampaign`: `sponsorId`, título/frase (<=90), imagem (upload reprocessado, limite de peso), `ctaLabel`, `destinationUrl` (**https** obrigatório,
  host guardado e validado), `startsAt/endsAt`, `status` (RASCUNHO | PENDENTE | ATIVA | PAUSADA | ENCERRADA), `weight`, `dailyCapPerDevice`,
  segmentação `{states[], cities[]}` (vazio = Brasil todo), `priceCents`/`billingPeriod` (informativo, cobrança manual no início), `approvedBy/At`.
- `SponsorStatDay (campaignId, day, state?, impressions, clicks)` — **só contadores agregados**.
- Endpoints: `GET /sponsors/active` (campanha(s) elegível(is) pela região do grupo, já filtrada por menor/idade do contexto), `POST /sponsors/:id/impression`
  (agregado; deduplicação por sessão no cliente e limite de taxa no servidor; bots/UA suspeito ignorados), `GET /sponsors/:id/click` (contador + `302` para o
  destino **gravado** — nunca um destino vindo da URL, para não virar open redirect). Admin: CRUD, aprovação, pausa, relatório.
- Relatório ao patrocinador: página/PDF com período, impressões, cliques, CTR e por UF, gerado no admin (compartilhável por link assinado com expiração).

### A4. Implementação (resumo)
- **Backend:** módulo `sponsors` (+ migration), validação de URL/domínio, contadores atômicos (upsert por dia), throttles, auditoria de aprovação.
- **Admin (Vue):** telas de patrocinadores e campanhas, pré-visualização do slide exatamente como no app, relatório.
- **App:** slide `sponsor` no `HeroCarouselView` (selo, folha "Por que vejo isso?", respeito a reduced-motion e a menores), cache curto de `/sponsors/active`.
- **Painel (grupos):** Fase 2 — o Mestre pode ter **patrocinador local do próprio grupo** (ex.: a loja de abadá da cidade) no banner do SEU grupo, com a
  receita ficando com o grupo. Isso também engaja os Mestres.

### A5. Preço e operação (a validar, sem promessa de resultado)
- Modelo simples para começar: **cota mensal fixa por região** (ex.: "Parceiro da roda — Goiás") em vez de pagar por clique; reajuste por alcance
  (alunos ativos da região). Valores só depois de medir impressões reais em 1-2 meses de teste gratuito com parceiros-piloto.
- Contrato curto padrão (prazo, categorias, conteúdo proibido, direito de remoção, sem exclusividade, sem acesso a dados), emissão de nota pela entidade.
- Indicadores: impressões/dia, CTR, campanhas ativas, receita mensal recorrente de patrocínio, % da meta de custos coberta.

### A6. Fases
- **F1 (M):** módulo + admin + slide no app + contadores + relatório simples + aprovação. Sem segmentação por cidade; só UF.
- **F2 (M):** patrocinador local do grupo (painel do Mestre), segmentação por cidade, agendamento, relatório em PDF.
- **F3 (G):** portal de autoatendimento do patrocinador com pagamento online.

### A7. Riscos e mitigação
Percepção de "virou propaganda" → rótulo claro, 1 slide, fora do 1º lugar, opção de esconder para apoiadores. Conteúdo impróprio → lista branca +
aprovação. Criança exposta → regra de menor + revisão jurídica. Conflito entre grupos/concorrentes → patrocinador por região, sem exclusividade.
Dependência de 1 patrocinador → vários de menor valor.

## FRENTE B — Apoio voluntário ("Amigo da Roda") + prestação de contas

### B1. Experiência
- **"Apoie o GingApp"** (Perfil/menu e a página de transparência): valores sugeridos (R$ 5, 10, 20, 50) e livre, **Pix com QR e copia-e-cola**; depois, recorrência.
- **Só adultos e responsáveis veem pedidos de apoio.** Menores nunca recebem pedido de pagamento. Convite discreto, no máximo **1 vez a cada 30 dias**
  e nunca durante fluxo de treino/check-in; "Agora não" respeitado.
- **Benefícios simbólicos (nada essencial fica pago):** selo "Amigo da Roda" no perfil (níveis por apoio acumulado, ex.: Semente, Broto, Ginga), nome no
  **Mural de apoiadores** (opt-in), conquista exclusiva da família `APOIO` no Ginga Rank, cartão de agradecimento, poder **esconder patrocinadores** e votar
  nas prioridades do que será construído ("Roteiro votável"). **Grupo apoiador:** selo na vitrine do grupo no mapa quando o Mestre apoia em nome do grupo.
- Todo apoio tem recibo/comprovante por e-mail e política clara (apoio voluntário; reembolso conforme a lei — texto com o advogado).

### B2. Prestação de contas pública (`/transparencia`, aberta, sem login)
Atualizada todo mês, em português simples:
- **Custos** por categoria (hospedagem/servidores, mapas, armazenamento e backup, notificações, e-mail, domínio, ferramentas, suporte/pessoas, impostos).
- **Receitas** por origem: apoios, patrocínios, editais/outras. **Saldo** e reserva.
- **Indicadores:** alunos ativos, grupos, **custo por aluno ativo por mês**, nº de apoiadores, % da meta do mês coberta (barra de progresso).
- **Histórico de 12 meses** e relatório trimestral em PDF; "para onde vai o excedente" (reserva, novas funções, editais).
- Lista de apoiadores **somente de quem autorizou** exibir o nome. Patrocinadores listados com a autorização deles.
- Nada de dado pessoal agregado de forma identificável; valores individuais de apoio nunca aparecem sem consentimento.

### B3. Modelo de dados (novas tabelas)
- `SupportContribution`: `amountCents`, `method` (PIX), `kind` (UNICO | RECORRENTE), `status` (PENDENTE | PAGO | FALHOU | ESTORNADO), `externalId`, `paidAt`,
  `supporterUserId?` (opcional), `onBehalfOfOrgId?`, `displayName?`, `showPublicly` (padrão falso), `receiptSentAt`.
- `LedgerEntry` (livro-caixa da plataforma): `type` (RECEITA | DESPESA), `category`, `amountCents`, `occurredOn`, `description`, `source`
  (APOIO | PATROCINIO | MANUAL), `publicVisible`, `attachmentRef?`. Apoios pagos e patrocínios geram lançamento (automático ou 1 clique); custos entram manualmente.
- `PlatformFinanceSettings`: meta mensal de custos (`monthlyGoalCents`), textos da página, política de reembolso, dados da entidade.
- Endpoints: `POST /support/pix` (cria cobrança Pix da conta DA PLATAFORMA), webhook (reaproveitar a infraestrutura de Pix/conciliação existente, apontando
  para a conta da plataforma — configuração própria, separada dos tokens dos grupos), `GET /transparency` (agregado público, cache curto), admin: lançamentos,
  metas, exportação CSV e relatório trimestral.

### B4. Implementação (resumo)
- **Backend:** módulo `support` + `transparency` (migrations, conciliação, agregados), recibo por e-mail, throttles, auditoria de lançamentos.
- **Admin (Vue):** "Financeiro da plataforma" (lançar custos/receitas, meta, publicar mês, exportar).
- **App:** tela "Apoie o GingApp" (Pix, confirmação, selo), página pública `/transparencia` (também acessível sem login), preferência "esconder patrocinadores".
- **Ranking:** conquista da família `APOIO` e selo no perfil.

### B5. Fases
- **F1 (P/M):** livro-caixa no admin + página pública de transparência (só dados lançados manualmente) + meta do mês. Não precisa de pagamento: já gera
  confiança e dá o "retrato de custos" para decidir preços.
- **F2 (M):** Pix avulso com QR e conciliação, mural, selo "Amigo da Roda", conquista `APOIO`, recibo por e-mail, esconder patrocinadores.
- **F3 (M/G):** apoio recorrente (Pix Automático ou assinatura do provedor, conforme o que o provedor suportar na época), apoio em nome do grupo, roteiro votável.

### B6. Estimativa ilustrativa (NÃO é previsão)
Cobertura = (apoiadores × valor médio + patrocínios) ÷ custos. Exemplo hipotético para raciocinar: se 2% de 10.000 adultos ativos apoiassem R$ 10/mês,
seriam R$ 2.000/mês. O número real só existe depois da F1 (custo por aluno) e de medir a conversão na F2.

## Como as duas frentes se combinam
- A página de transparência mostra **as duas receitas**; o patrocinador vê que o dinheiro sustenta algo aberto e auditável; o apoiador vê o resultado.
- Apoiador pode esconder patrocinadores: patrocínio é o "preço" de não apoiar, sem nunca bloquear funcionalidade.
- Ordem sugerida: **B-F1 (transparência) → A-F1 (patrocínio piloto)** → B-F2 (Pix) → A-F2 (patrocinador local) → B-F3.

## Decisões que dependem do dono (antes de construir)
1. **Forma jurídica** que vai receber (associação sem fins lucrativos, empresa/MEI, ou parceria com uma entidade existente) e quem emite nota/recibo.
2. **Nome e tom** do programa ("Amigo da Roda", "Parceiros da roda") e a identidade visual do selo.
3. **Quem aprova campanhas** de patrocínio e a lista de categorias permitidas/proibidas (a proposta acima é o ponto de partida).
4. **Menores:** confirmar a regra "nunca ver patrocinador nem pedido de apoio" e passá-la pelo advogado.
5. Se grupos poderão ter **patrocinador local** (Fase 2 da Frente A) e como a receita local se relaciona com a plataforma.
6. **Reembolso/estorno** de apoio e texto do termo.
7. **Custos reais** para publicar na transparência (comece listando as faturas dos últimos meses).
