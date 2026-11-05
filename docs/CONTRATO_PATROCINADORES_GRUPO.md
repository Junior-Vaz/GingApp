# Contrato — Patrocinadores do GRUPO (Frente A / Fase 2)

Complementa `docs/CONTRATO_PATROCINADORES.md` (leia-o primeiro: regras de ouro, enums, validação de URL, privacidade, menores, contadores, redirecionador e
decisões implementadas em §4.4 valem aqui, SALVO onde este documento diz o contrário). Decisões do dono: o **Mestre publica sozinho** (validações
automáticas + termo de responsabilidade; a plataforma pode pausar/bloquear) e o banner mostra **até 2 slides patrocinados: 1 do grupo + 1 da plataforma**.
A receita do patrocínio local é do GRUPO: a plataforma não cobra nem intermedeia (preço/observação são anotações privadas do Mestre).

## 1. Modelo de dados (migration NOVA escrita à mão, sem BOM: `20261106000100_sponsor_groups`)
- `Sponsor.organizationId Int?` e `SponsorCampaign.organizationId Int?` (FK Organization, **onDelete Cascade**; nulo = da PLATAFORMA, como hoje). Invariante: o patrocinador da
  campanha tem o MESMO `organizationId` da campanha. Índices por `organizationId`.
- `SponsorCampaign.platformSuspendedAt DateTime?`, `platformSuspendedByUserId Int?`, `platformSuspendReason String?` (suspensão feita pela PLATAFORMA; o Mestre NÃO pode retomar).
- `Organization.sponsorsBlockedAt DateTime?` (+ `sponsorsBlockedReason String?`): a plataforma bloqueia o uso de patrocínio local do grupo (campanhas do grupo param de ser servidas; o Mestre não ativa).
- Termo do Mestre: `Organization.sponsorTermsVersion String?`, `sponsorTermsAcceptedAt DateTime?`, `sponsorTermsAcceptedByUserId Int?`. Versão atual do termo = constante no código (`SPONSOR_TERMS_VERSION`).
- Campanha de grupo: `states` DEVE ser vazio (400 se vier), `weight` fixo 1 (ignora o enviado ou 400 — escolher 400 se diferente de 1), `category` obrigatória (lista branca), `priceCents/billingNote` privados.
- Os endpoints de PLATAFORMA existentes continuam listando por padrão SÓ `organizationId = null` (o comportamento atual e os testes atuais não mudam); ganham `?scope=GROUP&organizationId=` para supervisão.

## 2. Servir ao espectador (`GET /sponsors/active?studentId=` — muda o formato)
```ts
interface SponsorSlide { /* campos de hoje */ scope: 'GROUP' | 'PLATFORM'; groupName: string | null /* nome do grupo se scope=GROUP, senão null */ }
→ { items: SponsorSlide[] }   // 0, 1 ou 2 itens: no máximo 1 de cada escopo; o do GRUPO vem primeiro
```
- Escopo GRUPO: campanhas com `organizationId = organização do token` (a do espectador), `status=ACTIVE` na janela, SEM `platformSuspendedAt`, e grupo SEM `sponsorsBlockedAt`;
  sorteio entre elas por peso (todas peso 1 = uniforme). Escopo PLATAFORMA: como hoje.
- **Menor/aluno sem data/dependente menor = `{ items: [] }` para os DOIS escopos** (mesma regra, mesmo helper). `SPONSORS_ENABLED=false` desliga os dois.
- `POST /sponsors/:id/impression` e `GET /sponsors/:id/click` continuam iguais; a elegibilidade passa a considerar o escopo (campanha de grupo só conta para espectador DO MESMO grupo; clique em campanha
  inelegível/de outro grupo = 302 para o app sem contar — o clique é público, então para campanha de grupo NÃO se exige o grupo, só elegibilidade geral). Contadores continuam só `(campanha, dia, UF)`.
- Cabeçalhos/cache iguais (`private, max-age=300`). Nada de dado pessoal; o app nunca recebe contato/preço/notas.

## 3. API do Mestre (token de MEMBER **MESTRE** do grupo; qualquer outro papel = 403; `MestreOnlyGuard`/`assertMestre` existentes)
Prefixos: `/group-sponsors` e `/group-sponsor-campaigns` (+ termo). Todas as consultas/escritas filtradas pelo `organizationId` do token; id de outro grupo = 404.
- `GET /group-sponsors/terms` → `{ version, text, accepted: boolean, acceptedAt: string|null, blocked: boolean, blockedReason: string|null }` (texto do termo em português, versionado no código; revisão jurídica pendente).
- `POST /group-sponsors/terms/accept` (corpo `{ version }` igual à versão atual; senão 409 `TERMS_VERSION_MISMATCH`) → grava aceite do Mestre (usuário e instante).
- Patrocinadores do grupo: `GET` (lista, `?q=&limit=&offset=`, `X-Total-Count`), `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (409 `SPONSOR_HAS_CAMPAIGNS`). Mesmos campos do patrocinador da plataforma.
- Campanhas do grupo: `GET` (`?effective=&sponsorId=&q=`), `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/activate`, `/pause`, `/resume`, `GET /:id/report?from&to` (+ `.csv`).
  Mesmos campos/validações da plataforma EXCETO `states` (proibido) e `weight` (1). Respostas incluem `effectiveStatus`, `platformSuspended: boolean`, `platformSuspendReason`.
- **Ativar** exige: termo na versão atual aceito (senão 403 `SPONSOR_TERMS_REQUIRED`), grupo não bloqueado (403 `SPONSORS_BLOCKED`), campanha completa/válida e não encerrada, e grava `approvedByUserId/approvedAt` (o Mestre).
  **Retomar** uma campanha com `platformSuspendedAt` = 403 `SUSPENDED_BY_PLATFORM`. Editar conteúdo de campanha ACTIVE/PAUSED volta a DRAFT (como na plataforma).
- **Limites anti-abuso:** no máx. **10 patrocinadores** e **10 campanhas** por grupo (409 `SPONSOR_LIMIT`), **3 campanhas ACTIVE ao mesmo tempo**.
- **Imagens:** logo/imagem de campanha de GRUPO referenciam uploads do PRÓPRIO grupo (`POST /uploads` existente; o registro `Upload` precisa ter o `organizationId` do token); upload de plataforma ou de outro grupo = 400.
  Peso final <= 250 KB (reprocessar/recusar acima, como na plataforma — reutilizar a lógica do upload de plataforma com o teto de 250 KB para esse caso, sem enfraquecer o upload normal dos grupos).
  O coletor de órfãs deve continuar tratando essas colunas como referenciadas.
- Relatório do Mestre: mesmo formato da plataforma (totais, CTR, por dia, por UF); só campanhas do PRÓPRIO grupo.
- Auditoria (`AuditService`, com `organizationId` do grupo, sem dado pessoal): `SPONSOR_GROUP_TERMS_ACCEPT`, `SPONSOR_GROUP_SPONSOR_CREATE|UPDATE|DELETE`, `SPONSOR_GROUP_CAMPAIGN_CREATE|UPDATE|DELETE|ACTIVATE|PAUSE|RESUME`.

## 4. Plataforma (admin; usuários PLATFORM, ativar/bloquear só super admin onde indicado)
- `GET /platform-sponsor-campaigns?scope=GROUP&organizationId=&effective=&q=` e `GET /platform-sponsors?scope=GROUP&organizationId=`: lista as do grupo (respostas com `organization:{id,name}`).
- `POST /platform-sponsor-campaigns/:id/suspend` (corpo `{ reason }` 3..300) e `POST /platform-sponsor-campaigns/:id/unsuspend`: **qualquer PLATFORM** suspende campanha de grupo (a campanha para de ser servida na hora e o Mestre não retoma);
  levantar a suspensão é só super admin e volta a campanha ao status em que estava (PAUSED, para o Mestre decidir retomar).
- `POST /platform-sponsor-groups/:organizationId/block` (corpo `{ reason }`, só super admin) e `/unblock`: bloqueia/libera o patrocínio local do grupo todo. `GET /platform-sponsor-groups` → grupos que têm patrocinadores/campanhas
  (`{organizationId, name, sponsors, campaigns, activeNow, blocked, termsAcceptedAt}`).
- Relatório de campanha de grupo legível pela plataforma (`GET /platform-sponsor-campaigns/:id/report` já existente passa a aceitar campanhas de grupo).
- Auditoria: `SPONSOR_CAMPAIGN_SUSPEND|UNSUSPEND`, `SPONSOR_GROUP_BLOCK|UNBLOCK`.

## 5. Painel do Mestre (React, `painel.gingapp.com.br`)
Módulo **"Patrocinadores"** no menu, SÓ para MESTRE (professor etc. não veem; rota protegida como as demais áreas de Mestre):
1. **Termo de responsabilidade** (primeiro acesso e quando a versão mudar): texto completo, caixa "Li e aceito" e botão; sem aceitar, o resto fica em leitura e "Ativar" desabilitado com explicação.
   Mostra aviso se o grupo estiver **bloqueado pela plataforma** (com o motivo) e se uma campanha estiver **suspensa pela plataforma** (com o motivo; sem botão de retomar).
2. **Patrocinadores** (lista + criar/editar/excluir): nome, logo (upload do grupo), contato, documento, observações (privados do grupo).
3. **Campanhas** (lista com chips de `effectiveStatus` e filtros; formulário): patrocinador, título (60) e texto (90) com contadores, imagem (upload do grupo, 250 KB), botão (24), URL https com validação ao vivo, categoria da lista
   branca (rótulos em português), datas, preço/observação privados. **Pré-visualização fiel do slide a 375 px** com o selo "Patrocinado" e a faixa "Parceiro do <grupo>". Ativar/pausar/retomar/excluir com confirmação.
   Avisos explícitos: "Menores de 18 anos não veem patrocinadores", "O anúncio sempre mostra o selo Patrocinado", limites (3 ativas), categorias proibidas.
4. **Relatório** da campanha (totais, CTR, por dia; CSV) com "Os números são agregados e não identificam pessoas."
Estados de carregando/vazio/erro; mensagens de erro do servidor no campo; acessibilidade; testes no padrão do painel; `api` com os caminhos do §3.

## 6. App
`GET /sponsors/active` passa a trazer até 2 itens (`scope`, `groupName`). Posições no carrossel: o slide do GRUPO na 3ª posição (índice 2) e o da PLATAFORMA na 5ª (índice 4) ou, havendo poucos slides, no fim — nunca o 1º,
nunca dois patrocinados adjacentes quando houver como evitar. Chaves fixas por escopo (`patrocinado-grupo`, `patrocinado`) para o slide ativo não "pular" quando a campanha muda. Mesmo selo "Patrocinado"; no escopo GRUPO também
o texto "Parceiro do grupo <groupName>"; folha "Por que vejo isso?" por escopo: GRUPO = "Este anúncio é de <patrocinador>, parceiro do seu grupo, e não usa seus dados pessoais."; PLATAFORMA = texto atual.
Impressão: 1x por campanha por sessão (cada slide conta o seu). Menor/erro/vazio = como hoje. Resposta antiga (sem `scope`) continua aceita (trata como PLATAFORMA).

## 7. Admin (Vue)
Em "Patrocinadores": nova aba **"Dos grupos"**: lista de grupos com patrocínio (`/platform-sponsor-groups`), abrir um grupo para ver patrocinadores/campanhas (somente leitura), relatório, **suspender/levantar suspensão** de campanha
(motivo obrigatório) e **bloquear/liberar** o grupo (só super admin; motivo obrigatório), mostrando quem fez e quando. Chips de status e o `platformSuspended`.

## 8. Segurança / privacidade (resumo; vale tudo de `CONTRATO_PATROCINADORES.md` §2 e §8)
Isolamento multi-tenant (campanha de um grupo nunca é servida a outro nem aparece para outro Mestre); só MESTRE gere; menores nunca; sem PII nos contadores; URL e imagens validadas; limites por grupo; suspensão e bloqueio pela
plataforma; termo versionado com aceite registrado; auditoria sem dado pessoal; `SPONSORS_ENABLED=false` desliga tudo. Texto do termo e regras para anunciante local passam por revisão jurídica antes de uso real.
