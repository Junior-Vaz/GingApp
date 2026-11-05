# Contrato — Patrocinadores no banner da Home (piloto, Frente A / Fase 1)

Fonte única entre backend (`backend/src/interface/http/sponsors/*` + rotas de plataforma), admin Vue (`admin.gingapp.com.br`) e app
(`app.gingapp.com.br`, carrossel `HeroCarouselView`). Origem: `docs/PLANO_MONETIZACAO_PATROCINIO_E_APOIO.md` (Frente A). Em caso de dúvida este
documento vence; divergência = avisar, não adivinhar.

## 1. Escopo da Fase 1
Módulo de patrocinadores e campanhas gerido pela EQUIPE DA PLATAFORMA (admin Vue); um slide "Patrocinado" no carrossel da Home; contadores
agregados (impressões/cliques por dia e UF); relatório simples (JSON e CSV); ativação por usuário da plataforma. Segmentação só por **UF**.
FORA da F1: patrocinador local do grupo (painel do Mestre), segmentação por cidade, portal de autoatendimento, cobrança online, link assinado de
relatório, "esconder patrocinadores" para apoiadores (nem existe o programa de apoio ainda).

## 2. Regras de ouro (inegociáveis, com teste)
1. **Sem rastreamento:** nenhuma tabela guarda usuário, grupo, aparelho, IP ou qualquer identificador; só contadores `(campanha, dia, UF)`.
   Nenhum script/cookie/pixel de terceiros no app. Nenhuma lista de pessoas para o patrocinador.
2. **Menores nunca veem patrocinador** (servidor decide, app reforça): ver §5.
3. **Rotulagem:** o slide sempre mostra o selo **"Patrocinado"** (texto visível, não só cor/ícone) e não imita notificação, post nem aviso do Mestre.
4. **Aprovação humana:** só vai ao ar campanha ATIVADA por um usuário da plataforma (quem e quando ficam registrados).
5. **Categorias permitidas (lista branca, enum `SponsorCategory`):** `INSTRUMENTOS`, `VESTUARIO`, `SAUDE`, `EDUCACAO`, `EVENTOS_TURISMO`,
   `ALIMENTACAO`, `ESPORTES`. Proibidas por construção (não existem no enum): bebidas alcoólicas, apostas, tabaco, conteúdo adulto, crédito predatório, política partidária.
6. **Destino seguro:** `destinationUrl` só `https:`, sem usuário/senha na URL, host por nome (nada de IP/localhost/rede privada), máx. 500 caracteres, normalizada;
   o redirecionador usa SEMPRE o valor gravado (nunca um destino vindo da requisição).
7. **Interruptor de emergência:** env `SPONSORS_ENABLED` (padrão ligado; só `"false"` desliga): desligado, `GET /sponsors/active` devolve `[]` e o clique volta para o app.

## 3. Prisma (migration NOVA escrita à mão, sem BOM: `20261106000000_sponsors`)
```prisma
enum SponsorCategory { INSTRUMENTOS VESTUARIO SAUDE EDUCACAO EVENTOS_TURISMO ALIMENTACAO ESPORTES }
enum SponsorCampaignStatus { DRAFT ACTIVE PAUSED }       // "encerrada" é CALCULADA pelas datas, não é status

model Sponsor {
  id Int @id @default(autoincrement())
  name String            // 2..80
  logo String?           // referência de upload (formato de shared/uploads/image-ref.ts)
  contactName String?  contactEmail String?  contactPhone String?   // comerciais; nunca expostos ao app
  document String?       // CNPJ/CPF opcional (só admin)
  notes String?          // até 1000
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  campaigns SponsorCampaign[]
}
model SponsorCampaign {
  id Int @id @default(autoincrement())
  sponsorId Int  (FK Sponsor, onDelete Restrict)
  title String           // 2..60
  text String            // 2..90 (texto puro)
  imageRef String?       // upload
  ctaLabel String @default("Conhecer")   // 2..24
  destinationUrl String  destinationHost String
  category SponsorCategory
  startsAt DateTime  endsAt DateTime     // endsAt > startsAt; janela máx. 366 dias
  status SponsorCampaignStatus @default(DRAFT)
  weight Int @default(1)                 // 1..10
  states String[] @default([])           // UFs ('GO','SP'...); vazio = Brasil todo
  priceCents Int?  billingNote String?   // informativo (cobrança manual na F1), só admin
  approvedByUserId Int?  approvedAt DateTime?
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  stats SponsorStatDay[]
  @@index([status, startsAt, endsAt])
}
model SponsorStatDay {
  id Int @id @default(autoincrement())
  campaignId Int (FK, onDelete Cascade)
  day String            // 'YYYY-MM-DD' em America/Sao_Paulo
  state String @default("")   // UF ou '' (desconhecida)
  impressions Int @default(0)  clicks Int @default(0)
  @@unique([campaignId, day, state])
}
```
**Elegível agora** = `status = ACTIVE` E `now` em `[startsAt, endsAt)` E categoria válida. Ativar exige: campanha completa e válida, patrocinador existente,
e grava `approvedByUserId/approvedAt` (quem ativa). Editar campos de conteúdo de uma campanha ATIVA a volta para `DRAFT` (nova aprovação).
O coletor de imagens órfãs (`UPLOADS_GC`) precisa tratar logos/imagens de patrocinadores como referenciadas (já varre colunas String; CONFIRMAR e testar).

## 4. API

### 4.1 App (token de MEMBER do grupo)
`GET /sponsors/active?studentId=` →
```ts
interface SponsorSlide {
  id: number;                 // id da campanha
  sponsorName: string;
  logoUrl: string | null;     // /api/uploads/<arquivo> (ou null)
  imageUrl: string | null;
  title: string; text: string; ctaLabel: string;
  clickPath: string;          // '/api/sponsors/<id>/click?s=<UF>'  (UF da região do espectador, ou omitido)
  state: string;              // UF usada na contagem ('' se desconhecida)
}
→ { items: SponsorSlide[] }   // 0 ou 1 item (rotação ponderada por `weight` entre as elegíveis na região); nunca dado de contato/preço/notas
```
- Região do espectador = UF da unidade do aluno efetivo (`studentId` válido do usuário; senão o aluno do próprio usuário; senão a UF da unidade principal do grupo);
  sem UF = só campanhas nacionais (`states` vazio). Campanha com `states` só aparece se a UF do espectador estiver na lista.
- `Cache-Control: private, max-age=300`. `SPONSORS_ENABLED=false` ou menor (§5) = `{ items: [] }`.

`POST /sponsors/:id/impression` (sem corpo; corpo/campo extra = 400) → `204`. Conta +1 em `(campanha, dia SP, UF do espectador)` SÓ se a campanha estiver elegível agora
e o `User-Agent` não parecer robô; menor (§5) ou campanha inelegível = `204` sem contar (sem revelar nada). Throttle 120/min por usuário.

### 4.2 Clique (PÚBLICO: link aberto numa nova aba não leva Authorization)
`GET /sponsors/:id/click?s=<UF>` → `302` para `destinationUrl` **gravada** + parâmetros `utm_source=gingapp&utm_medium=parceiro&utm_campaign=c<id>` (preservando os
que já existirem na URL). Conta +1 clique em `(campanha, dia SP, UF válida de `s` ou '')`. Campanha inelegível/inexistente/`SPONSORS_ENABLED=false` = `302` para `<APP_URL>/`
(ou `404` se não houver APP_URL) sem contar. Cabeçalhos: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`. Throttle por IP (60/min).
Nunca loga nem guarda IP/UA do clique.

### 4.3 Plataforma (somente PLATFORM autenticado, padrão dos controllers de plataforma existentes, ex.: `PlatformAnnouncement`)
Prefixo `/platform/sponsors` e `/platform/sponsor-campaigns` (acompanhar a convenção do projeto):
- Patrocinadores: `GET` (lista), `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (409 `SPONSOR_HAS_CAMPAIGNS` se houver campanhas).
- Campanhas: `GET` (filtros `status`, `sponsorId`, `effective` = `ACTIVE_NOW|SCHEDULED|ENDED|DRAFT|PAUSED`, paginado como o resto), `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`
  (apaga também as estatísticas), `POST /:id/activate` (SÓ super admin; valida tudo; grava aprovador), `POST /:id/pause`, `POST /:id/resume` (volta a ACTIVE sem nova aprovação se o conteúdo não mudou).
- `GET /platform/sponsor-campaigns/:id/report?from=YYYY-MM-DD&to=YYYY-MM-DD` →
  `{ campaign: {id,title,sponsorName,startsAt,endsAt,status}, totals: {impressions,clicks,ctr}, byDay: [{day,impressions,clicks}], byState: [{state,impressions,clicks}] }`
  (`ctr` = cliques/impressões em %, 2 casas; 0 sem impressões) e `...report.csv` (mesmos dados, UTF-8 com BOM, `;`, proteção contra injeção de fórmula como o CSV existente).
- Campo `effectiveStatus` calculado nas leituras: `DRAFT | PAUSED | SCHEDULED | ACTIVE_NOW | ENDED`.
- Imagens: o admin precisa enviar logo/imagem. Se o upload atual exigir grupo, criar a variante de plataforma mínima (ex.: `POST /platform/uploads`, mesmas validações/sharp,
  limite de peso), SEM enfraquecer o upload de grupo; imagem >= 1200x630 recomendada (WebP/JPEG reprocessado), peso final <= 250 KB (reprocessar/recusar acima).
- Validação (400 em português com o campo): nomes/textos puros (sem HTML; `normalizeUserText`), URL do §2.6, datas, `weight`, UFs válidas (27 UFs), categoria do enum, janela <= 366 dias.
- Auditoria (`AuditService`, sem dados pessoais): `SPONSOR_CREATE|UPDATE|DELETE`, `SPONSOR_CAMPAIGN_CREATE|UPDATE|DELETE|ACTIVATE|PAUSE|RESUME`.

### 4.4 Decisões e desvios IMPLEMENTADOS (registrados após a entrega; valem sobre o texto acima)
- **Prefixos de plataforma seguem a convenção do projeto (hífen), não `/platform/...`:** `/platform-sponsors`, `/platform-sponsor-campaigns` (+ `/:id/activate|pause|resume`,
  `/:id/report`, `/:id/report.csv`) e `/platform-uploads` (multipart `file`, só PLATFORM, imagem reprocessada até <= 250 KB, `PLATFORM_UPLOAD_MAX_KB`; acima disso 413).
  Listas = array + `X-Total-Count`; filtros `?q=&limit=&offset=` (+ `status`, `sponsorId`, `effective` nas campanhas).
- `Upload.organizationId` passou a ser opcional: nulo = imagem da PLATAFORMA. `logo`/`imageRef` só aceitam `/api/uploads/...` de registro de plataforma.
- Respostas de campanha trazem também `sponsor:{id,name,logo}`, `sponsorName` e `approvedBy:{id,name}`.
- `effectiveStatus`: ENDED vence qualquer status gravado; ativar campanha encerrada = 400 `CAMPAIGN_ENDED`; ativar campanha já ACTIVE = 409 `INVALID_TRANSITION`.
- Volta a DRAFT (e limpa a aprovação) ao mudar conteúdo (sponsorId, title, text, imageRef, ctaLabel, destinationUrl, category) de campanha ACTIVE **ou PAUSED**; datas, peso, UFs e preço não voltam.
- Região do espectador: UF da unidade do aluno efetivo; senão unidade principal ativa; senão `Organization.state`; senão ''. Impressão só conta se a campanha também casar com a região.
- Menor: dependente via `studentId` pela data da ficha, senão da matrícula, **sem data = menor**; `studentId` alheio/inexistente cai no próprio usuário.
- Validação de URL além do contrato: recusa domínio com unicode/`xn--`, qualquer porta explícita (`:443` é removida), caracteres invisíveis/de controle, barra invertida e sufixos `.test`, `.onion`, `.arpa`.
  Texto com cara de tag (`<b>`, `<!--`) = 400. Erro de URL: `400 {code:'INVALID_DESTINATION_URL', field:'destinationUrl'}`.
- Impressão e clique não auditam nada; `/api/sponsors/*` saem no log com `userId:null` e `ip:null`. Auditoria de plataforma grava usuário/IP do funcionário (padrão das ações de plataforma).
- Env: `SPONSOR_IMPRESSION_THROTTLE_LIMIT` (120), `SPONSOR_IMPRESSION_IP_THROTTLE_LIMIT`, `SPONSOR_CLICK_THROTTLE_LIMIT` (60), `PLATFORM_UPLOAD_MAX_KB` (250), `SPONSORS_ENABLED`.
- Admin: upload de logo só na tela de Patrocinadores (a campanha só tem imagem de fundo); ativar só super admin; o admin recusa no navegador imagem > 250 KB ou que não seja JPEG/PNG/WebP.

## 5. Menores (regra do servidor, igual ao critério do feed)
Espectador efetivo = aluno de `studentId` (se for do usuário) ou o aluno do próprio usuário. É MENOR se tem data de nascimento (Person, senão matrícula) com < 18 anos,
ou se é papel ALUNO sem nenhuma data (conservador). Usuário sem aluno (equipe/responsável sem perfil de aluno) e adulto = elegível. Menor = `GET /sponsors/active` devolve
`{ items: [] }` e as impressões não contam. O app TAMBÉM não renderiza nem pede o slide quando o perfil ativo é menor.

## 6. App
- `HeroCarouselView`/`HeroCarousel`: novo tipo de slide `tone: "sponsor"` inserido na 3ª posição (ou no fim se houver menos de 3), nunca em 1º. Busca `GET /sponsors/active?studentId=`
  (staleTime 5 min, sem retry, erro/vazio/menor = nenhum slide, sem mensagem). Layout: imagem de fundo (ou degradê neutro), chip do logo, selo **"Patrocinado"**, título, texto, botão `ctaLabel` como
  `<a href={clickPath} target="_blank" rel="sponsored noopener noreferrer">`; botão discreto **"Por que vejo isso?"** abre folha: "O GingApp é gratuito e se mantém com o apoio de parceiros. Este anúncio é de
  <patrocinador> e não usa seus dados pessoais." Contraste e leitura em 320 px; `prefers-reduced-motion` como os outros slides.
- Impressão: `POST /sponsors/:id/impression` UMA vez por campanha por sessão do navegador (sessionStorage com try/catch), quando o slide fica ativo e visível por >= 1 s; falha silenciosa; nada guardado.
- Nenhum dado do patrocinador vai para localStorage; nenhum script/imagem de terceiro (as imagens vêm de `/api/uploads`).

## 7. Admin (Vue)
Menu **"Patrocinadores"** (usuários da plataforma): (1) lista/edição de patrocinadores (logo, contato, notas); (2) lista de campanhas com chips de `effectiveStatus`, filtros e busca;
(3) formulário de campanha (patrocinador, título/texto com contadores, imagem e logo com upload, botão, URL com validação ao vivo e aviso se não for https, categoria da lista branca, UFs em multisseleção,
datas, peso, preço/observação de cobrança) com **pré-visualização fiel do slide** (mesma aparência do app, 375 px) e do rótulo "Patrocinado"; (4) ativar/pausar/retomar com confirmação (ativar só super admin,
mostrando quem aprovou e quando); (5) **relatório** da campanha (totais, CTR, tabela/barras por dia e por UF, exportar CSV). Textos em português; padrão visual e de testes do admin existente.

## 8. Segurança / limites (resumo)
Sem PII nas métricas; redirecionador sem open redirect; URL https validada e normalizada; imagens só por upload reprocessado e com peso limitado; throttles (impressão 120/min/usuário, clique 60/min/IP);
anti-robô simples por `User-Agent` na impressão; texto puro; interruptor `SPONSORS_ENABLED`; auditoria das ações da plataforma; menores nunca. Multi-tenant: o app só recebe campanhas elegíveis pela região; nada de
um grupo revela outro. Contrato de venda, categorias aceitas e tributação são decisão do dono com advogado/contador (fora do código).
