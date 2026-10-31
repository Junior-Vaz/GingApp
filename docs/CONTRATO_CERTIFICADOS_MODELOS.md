# Contrato — Modelos de certificado (F1)

Fonte única entre backend (`backend/src/interface/http/certificates/*`) e painel (`painel.gingapp.com.br/src/modules/certificados/*`).
Decisões do dono: F1 completa; certificado já emitido guarda uma CÓPIA do desenho (editar o modelo não o altera);
**Mestre e Professor** criam/editam modelos. Em caso de dúvida, este documento vence; divergência = avisar, não adivinhar.

## 1. Ideia

Cada grupo tem **modelos** de certificado. Um modelo é uma página (A4 paisagem ou retrato) com fundo e uma lista de
**elementos** posicionados em porcentagem da página (texto com variáveis, imagem, retângulo, QR Code). O PDF é SEMPRE gerado
pelo backend a partir desse desenho (um único renderizador, também usado para os certificados antigos). O editor do painel só
produz/edita o JSON do desenho e pede a pré-visualização em PDF ao backend.

## 2. Formato do desenho (`CertificateLayout`, versão 1)

```ts
interface CertificateLayout {
  version: 1;
  page: {
    orientation: 'landscape' | 'portrait';          // A4: 842x595 pt (paisagem) | 595x842 pt (retrato)
    background: {
      color: string;                                 // '#RRGGBB' (normalizado para MAIÚSCULO)
      imageRef?: string | null;                      // referência de upload do próprio grupo (ver §6)
      imageFit?: 'cover' | 'contain';                // padrão 'cover'
    };
  };
  elements: CertificateElement[];                    // ordem = z-order (o último fica por cima); 1..40 itens
}

type CertificateElement = TextEl | ImageEl | RectEl | QrEl;

interface BaseEl { id: string }                      // 1..40 chars [a-z0-9-], único no desenho

interface TextEl extends BaseEl {
  type: 'text';
  x: number; y: number; w: number; h: number;        // % da página (0..100); w,h >= 1; x+w <= 100; y+h <= 100
  text: string;                                      // 1..500 chars, com variáveis {…} (§3); \n = quebra de linha
  fontKey: FontKey;                                  // §4
  size: number;                                      // pt na página de referência A4 (6..160)
  color: string;                                     // '#RRGGBB'
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  bold: boolean; italic: boolean;                    // flag que a fonte não tem = ignorada no PDF (o editor a desabilita)
  uppercase: boolean;
  letterSpacing: number;                             // pt, 0..30
  lineHeight: number;                                // multiplicador, 0.8..2.5
}

interface ImageEl extends BaseEl {
  type: 'image';
  x: number; y: number; w: number; h: number;
  ref?: string | null;                               // referência de upload (§6); ignorada se useGroupLogo
  useGroupLogo: boolean;                             // true = usa Organization.logo no momento de emitir/pré-visualizar
  fit: 'contain' | 'cover';
  opacity: number;                                   // 0..1
}

interface RectEl extends BaseEl {
  type: 'rect';
  x: number; y: number; w: number; h: number;
  fill: string | null;                               // '#RRGGBB' ou null (sem preenchimento)
  fillOpacity: number;                               // 0..1
  stroke: string | null;                             // '#RRGGBB' ou null
  strokeWidth: number;                               // pt, 0..20
  radius: number;                                    // pt, 0..200 (cantos arredondados)
}

interface QrEl extends BaseEl {
  type: 'qr';
  x: number; y: number;                              // canto superior esquerdo, % da página
  size: number;                                      // lado em pt (56..220); quadrado; x+size e y+size precisam caber na página
  fg: string;                                        // '#RRGGBB' ESCURO (luminância relativa <= 0.45); o QR é desenhado sobre uma placa branca com margem
}
```

### Regras de validação (backend recusa com 400; o editor impede)
- Exatamente **1** elemento `qr` (NÃO pode ser removido) e ao menos **1** texto contendo `{codigo}` ou `{link}`.
- Máx. **40** elementos, máx. **8** imagens (contando o fundo), `JSON.stringify(layout)` <= **64 KB**.
- Só as chaves do contrato (campo extra = 400). Números finitos, dentro das faixas. Cores só `#RRGGBB` (3 dígitos NÃO).
- Variável desconhecida em `text` (qualquer `{palavra}` fora da lista do §3) = 400. Chaves soltas `{`/`}` sem variável válida = 400.
- Texto: sem HTML interpretado (é texto puro no PDF), caracteres de controle removidos, normalização como o feed (`normalizeUserText` se servir).
- `imageRef` / `ref`: formato e propriedade do §6.

## 3. Variáveis de texto

| Variável | Valor |
|---|---|
| `{aluno}` | nome do aluno |
| `{grupo}` | nome do grupo |
| `{titulo}` | título do certificado |
| `{graduacao}` | nome do nível de graduação vinculado (vazio se não houver) |
| `{data}` | data de emissão `dd/mm/aaaa` (data civil, `formatCivilDateBR`) |
| `{dataExtenso}` | `12 de março de 2026` |
| `{codigo}` | código de verificação |
| `{link}` | URL pública de verificação (vazio se `APP_URL` não estiver configurada) |

Substituição simples (sem expressões), valor ausente = string vazia. Painel e backend usam EXATAMENTE esta lista (o painel a
traz como constante e há teste de conformidade). Dados de exemplo da pré-visualização: aluno "Maria da Silva Santos", grupo =
nome real do grupo, título "Batizado e troca de corda", graduação "Corda Verde", data = hoje, código `EXEMPLO-0000`, link
`<APP_URL>/verificar/EXEMPLO-0000`; o QR da prévia é de exemplo (nunca um código real).

## 4. Fontes (`FontKey`)

SSOT nos dois lados: `helvetica | playfair | cinzel | lora | montserrat | greatvibes`.

| Chave | Família | bold | italic |
|---|---|---|---|
| `helvetica` | Helvetica (embutida do PDF; rótulo "Padrão") | sim | sim |
| `playfair` | Playfair Display | sim | sim |
| `cinzel` | Cinzel | sim | não |
| `lora` | Lora | sim | sim |
| `montserrat` | Montserrat | sim | sim |
| `greatvibes` | Great Vibes (manuscrita) | não | não |

Todas livres (OFL). Backend: arquivos versionados em `backend/assets/fonts/` (copiados para `dist` e para a imagem Docker),
carregados no pdfkit; fonte que falhar ao carregar cai em `helvetica` (nunca derruba o PDF). Painel: pacotes `@fontsource/*`
(subset latin). Cobrir acentos do português.

## 5. Modelo salvo, uso e padrão

```ts
type CertificatePurpose = 'GRADUACAO' | 'BATIZADO' | 'EVENTO' | 'PARTICIPACAO' | 'OUTRO';

interface CertificateTemplate {
  id: number;
  name: string;                  // 1..60
  purpose: CertificatePurpose;
  isDefault: boolean;            // no máximo 1 padrão por (grupo, uso)
  layout: CertificateLayout;
  createdAt: string; updatedAt: string;
}
interface CertificateTemplateSummary { id; name; purpose; isDefault; orientation; updatedAt }   // lista, sem o layout
```

Prisma: `CertificateTemplate { id, organizationId, name, purpose, isDefault, layout Json, createdByUserId Int?, createdAt, updatedAt }`
(exclusão REAL; índice único parcial `(organizationId, purpose) WHERE "isDefault"` na migration escrita à mão, sem BOM) e em
`Certificate`: `templateId Int? (onDelete SetNull)`, `layoutSnapshot Json?`. Máx. **30** modelos por grupo (409 `TEMPLATE_LIMIT`).

**Modelos prontos** (presets) vivem no CÓDIGO (`CERTIFICATE_PRESETS`, sem imagens de upload): `classico` (o desenho atual, moldura
dupla laranja), `moderno`, `batizado`, `evento`, `minimalista`; cada um com chave, nome, uso sugerido e layout válido. O painel os
lista e cria uma cópia editável (`POST /certificate-templates` com `presetKey`). O **clássico** também é o desenho embutido usado
para certificados antigos (sem `layoutSnapshot`) e quando o grupo não tem modelo padrão.

## 6. Imagens

Sempre pelo upload existente (`POST /uploads`, que reprocessa com sharp); o desenho guarda só a **referência** (o mesmo formato
já usado em `Organization.logo`/fotos: ver `shared/uploads/image-ref.ts`). Backend valida o formato da referência e recusa
qualquer coisa fora dele (sem URL externa, sem `..`). Arquivo ausente no disco na hora de gerar = o elemento é pulado (o PDF
nunca falha por isso). **O coletor de imagens órfãs (`UPLOADS_GC`) PRECISA tratar como referenciadas as imagens de
`CertificateTemplate.layout` e de `Certificate.layoutSnapshot`** (senão um certificado emitido perde o fundo).

## 7. Rotas (todas sob o token do grupo; 404 igual ao inexistente para outro grupo)

Permissões: a matriz existente do recurso `certificates` (`PermissionsService`): ver/listar/presets/pré-visualizar = quem tem
`certificates:view` (MESTRE, PROFESSOR, INSTRUTOR); criar/duplicar = `certificates:create`; editar/definir padrão =
`certificates:edit`; **excluir modelo = `certificates:edit`** (não `delete`): na matriz o PROFESSOR não tem `delete` em
`certificates`, e dar-lhe `delete` o deixaria apagar CERTIFICADOS emitidos; excluir um modelo não apaga certificado algum.
Resultado: MESTRE e PROFESSOR fazem tudo; INSTRUTOR só lê/pré-visualiza; MONITOR, ALUNO e RESPONSAVEL = 403. A matriz NÃO
foi alterada. Modelos são do GRUPO inteiro: o escopo de unidade NÃO se aplica.

| Método e rota | Corpo / resposta |
|---|---|
| `GET /certificate-templates` | `CertificateTemplateSummary[]` (do grupo) |
| `GET /certificate-templates/presets` | `{ key, name, purpose, layout }[]` |
| `GET /certificate-templates/:id` | `CertificateTemplate` |
| `POST /certificate-templates` | `{ name, purpose, layout }` OU `{ name, purpose?, presetKey }` → 201 `CertificateTemplate` |
| `PATCH /certificate-templates/:id` | `{ name?, purpose?, layout? }` → `CertificateTemplate` |
| `POST /certificate-templates/:id/duplicate` | 201 cópia (`name` + " (cópia)", `isDefault=false`) |
| `POST /certificate-templates/:id/default` | marca como padrão do seu uso (troca o anterior numa transação) → `CertificateTemplate` |
| `DELETE /certificate-templates/:id` | 204 (certificados emitidos seguem pelo `layoutSnapshot`) |
| `POST /certificate-templates/preview` | `{ layout }` → `application/pdf` com dados de exemplo (§3). Limite 20/min por usuário (como o upload). Declarada ANTES de `/:id` |

Erros: 400 validação (mensagem em português, indicando elemento/campo quando possível), 403 sem permissão, 404, 409
`TEMPLATE_LIMIT`. Corpo com campo desconhecido = 400 (whitelist global).
Formato dos erros do desenho: `{ statusCode: 400, error: 'Bad Request', code: 'LAYOUT_INVALID', message }` com a mensagem
apontando o elemento (ex.: `Elemento "titulo" (texto): variável desconhecida {nome}. Use só: ...`); imagem que não é upload
do grupo também vem como `LAYOUT_INVALID`. Limite: `{ statusCode: 409, error: 'Conflict', code: 'TEMPLATE_LIMIT', message }`.
Erros de DTO (nome, purpose, presetKey, layout não-objeto, campo extra) seguem o formato padrão do Nest (`message` em lista).
`POST /:id/default` e `POST /preview` respondem 200; `POST /` e `POST /:id/duplicate` respondem 201; `DELETE` 204 sem corpo.
`PATCH` que troca o `purpose` de um modelo padrão tira o padrão dele (`isDefault=false`; o padrão do uso novo não muda).

**Emissão** — `POST /certificates` ganha `templateId?: number`:
1. `templateId` informado: precisa ser do grupo (senão 400/404 como hoje); usa esse modelo.
2. Omitido: o padrão do uso — `GRADUACAO` se houver `studentGraduationId`, senão `OUTRO` —; se o grupo não tiver padrão, o `classico` embutido.
3. O certificado grava `templateId` e `layoutSnapshot` = layout resolvido no momento (com `useGroupLogo` já trocado pela referência
   concreta do logo; se o grupo não tem logo, o elemento sai do snapshot). `PATCH /certificates/:id` NÃO muda o snapshot.
4. `GET /certificates/:id/pdf` (e o PDF público/do app) renderiza o `layoutSnapshot`; sem snapshot (antigos) = `classico`.
A resposta de leitura do certificado passa a incluir `templateId: number | null`.

### Detalhes do backend (definidos na implementação)
- Normalização devolvida pelo backend: cores em MAIÚSCULO; `background.imageRef` (null) e `imageFit` ('cover') e `image.ref`
  (null) sempre presentes; texto normalizado como o feed (NFC, sem controle/invisíveis, espaços repetidos colapsados).
- Imagem com `useGroupLogo=false` e `ref=null` é aceita (não desenha nada). `Organization.logo` que não seja upload do backend
  (URL externa) conta como "sem logo": o elemento sai do snapshot/prévia (o PDF nunca busca imagem fora do diretório de uploads).
- Texto: quebra pela largura e corta na altura, mas a 1ª linha SEMPRE sai (mesmo numa caixa menor que a linha). Sem `APP_URL`,
  o QR leva o código de verificação. Ligaduras (fi/fl) desligadas para o texto copiado do PDF ficar correto.
- Pré-visualização: 20/min por usuário (`CERT_PREVIEW_THROTTLE_LIMIT`) e 120/min por IP (`CERT_PREVIEW_IP_THROTTLE_LIMIT`);
  responde `Content-Disposition: inline`.
- Fontes: `.woff` do `@fontsource` (subset latin, cobre o português) em `backend/assets/fonts` (+ licenças OFL), copiadas
  para `dist/assets/fonts` pelo `nest-cli.json`.

## 8. Segurança e limites (resumo para os dois lados)
- Entrada só validada (whitelist de chaves, faixas, tamanho); nada de HTML/SVG/URL externa; imagens só por referência de upload.
- O QR e o código de verificação não podem sair do desenho; o QR sempre sobre placa branca, escuro, >= 56 pt.
- Renderização com teto (40 elementos, 8 imagens, texto 500) e arquivo de imagem lido com limite; falha de imagem/fonte nunca derruba o PDF.
- Auditoria (`AuditService`, sem o conteúdo dos textos): `CERTIFICATE_TEMPLATE_CREATE | UPDATE | DELETE | DEFAULT`.
- Multi-tenant: toda leitura/escrita filtrada por `organizationId` do token; id de outro grupo = 404.

## 9. Editor (painel) — comportamento esperado
Rota `/certificados/modelos` (aba "Modelos" dentro de Certificados): lista (cards com miniatura simples, nome, uso, "Padrão",
duplicar/excluir/definir padrão), "Novo a partir de modelo pronto" e o editor: folha no centro proporcional (842:595 ou 595:842),
elementos arrastáveis/redimensionáveis (mouse e toque), guias de alinhamento (bordas/centro da página e de outros elementos),
setas movem 1% (Shift 5%), Delete remove (exceto QR), duplicar, ordem (frente/trás), desfazer/refazer, painel lateral de
propriedades por tipo, inserir variável (chips), fundo (cor + imagem enviada + ajuste), pré-visualizar PDF (backend), salvar com
aviso de alterações não salvas. O QR aparece travado (move/redimensiona, não remove). Na emissão de certificado: seletor de modelo
(padrão pré-selecionado) com pré-visualização.
