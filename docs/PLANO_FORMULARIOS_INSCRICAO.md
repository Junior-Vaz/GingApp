# Planejamento: Formulários de inscrição públicos (substituir o Google Forms)

Status: **proposta para decisão** (nada implementado). Data: 2026-10-18.

## 1. Problema e objetivo

Hoje os grupos montam a inscrição de um campeonato/evento no Google Forms + Planilhas: texto de apresentação com banner,
seções de dados do competidor, termos de aceite, instruções de Pix, upload de comprovante e depois uma planilha com as
respostas (o exemplo real: *1º Campeonato de Capoeira no Varjão DF*, 95 respostas, R$ 25,00 por participante, comprovante
conferido à mão).

Objetivo: o Mestre cadastra o evento no GingApp, **monta o formulário do jeito que quiser**, gera um **link público** para
mandar no WhatsApp/Instagram, e acompanha as inscrições, os pagamentos e a lista de participantes **dentro do GingApp**,
sem planilha e sem conferir comprovante em outro lugar.

Não é objetivo copiar o Google Forms inteiro (provas com nota, lógica ramificada complexa, temas). É o essencial para
inscrição de evento/campeonato/curso/batizado/troca de corda.

## 2. O que já existe no GingApp e será reaproveitado (SSOT, sem reimplementar)

| Peça existente | Como entra |
|---|---|
| `Event` (título, data, local, imagem de capa, `capacity`, `priceCents`, `registrationDeadline`, `status` DRAFT/PUBLISHED/CLOSED/CANCELLED, `isPublic`, mapa) | O formulário nasce **ligado a um evento**; vagas, prazo e status continuam valendo. |
| `EventParticipant` (aluno, usuário **ou `guestName`**; status CONFIRMED/WAITLIST/ATTENDED) | Inscrição confirmada vira participante do evento (lista de presença/check-in já existe). |
| Pix Mercado Pago por grupo (modo manual, token do próprio grupo, webhook, baixa automática, reconciliação) | Cobrança automática da taxa de inscrição. Precisa ser generalizada para cobrar **quem não é aluno** (ver 5). |
| Rotas públicas (`@Public`, ex.: verificação de certificado/passaporte) + rate limit global | Padrão para a página pública e o envio da inscrição. |
| Upload de imagens (`/uploads`, hoje só autenticado e só imagem) | Base para o comprovante; precisa de uma variante **anônima, privada e com PDF** (ver 6). |
| Ficha única (CPF com hash + AES-GCM, código GingApp, deduplicação) | Se o inscrito é aluno, liga à ficha; se é de fora, guarda CPF protegido do mesmo jeito. |
| Notificações (sino/push) e e-mail (SMTP opcional) | Aviso de nova inscrição ao Mestre; confirmação/recusa ao inscrito (e-mail/WhatsApp). |
| Exportação CSV do painel | Exportar respostas (substitui a planilha). |
| Documentos legais/LGPD, pedido de exclusão de dados, auditoria | Consentimento, retenção e trilha de quem viu/exportou dados pessoais. |

## 3. O que falta construir

1. **Construtor de formulário** no painel (campos, seções, ordem, obrigatoriedade, textos, banner).
2. **Página pública** de inscrição (`/i/<slug>`), mobile-first, com pré-visualização no WhatsApp.
3. **Armazenamento das respostas** (inscrições) com status, pagamento e anexos.
4. **Pagamento**: Pix automático (Mercado Pago) **e** modo manual (chave Pix + comprovante), como o Forms de hoje.
5. **Upload anônimo e privado** de comprovante/documento.
6. **Tela de gestão das inscrições** (filtros, aprovar/recusar, pagamento, exportar, avisar, vagas e lista de espera).
7. **Importação das respostas antigas** (CSV do Google Forms/Planilhas) para quem já tem histórico.

## 4. Modelo de dados proposto (resumo)

- `RegistrationForm`: `organizationId`, `eventId?` (opcional: também serve para curso/batizado sem evento), `slug` único,
  `title`, `intro` (texto rico simples + banner), `status` (DRAFT/OPEN/CLOSED), `opensAt?`, `closesAt?`,
  `maxSubmissions?`, `paymentMode` (NONE | PIX_MANUAL | PIX_AUTO), `priceCents`, `pixKeyLabel/pixKey` (modo manual),
  `confirmationMessage`, `requireApproval` (true = Mestre aprova; false = confirma sozinho ao pagar), `captchaEnabled`.
- `RegistrationFormField`: `formId`, `sectionId?`, `order`, `type`, `label`, `helpText`, `required`, `options` (JSON),
  `validation` (JSON: tamanho, máscara, mínimo/máximo), `showIf` (JSON simples: "campo X = valor Y"), `mapsTo?`
  (mapeamento opcional para a ficha: nome, apelido, nascimento, CPF, telefone, e-mail, graduação, grupo).
- `RegistrationSubmission`: `formId`, `protocol` (código curto tipo `INS-7K3Q`), `status` (PENDING | AWAITING_PAYMENT |
  PAID | CONFIRMED | WAITLIST | REJECTED | CANCELLED), `answers` (JSON versionado pelo id do campo),
  identificação protegida (CPF hash + criptografado, e-mail, telefone), `personId?`/`studentId?` (quando reconhecido),
  `eventParticipantId?`, `ipHash`, `userAgent` truncado, `createdAt`, `reviewedById/At`, `reviewNote`.
- `RegistrationSubmissionFile`: arquivo privado (comprovante/documento), tipo, tamanho, hash, `submissionId`.
- Cobrança do Pix: ver seção 5 (campos no próprio `RegistrationSubmission` ou tabela `Charge` genérica).

### Tipos de campo (MVP → depois)

MVP: texto curto, texto longo, número, e-mail, telefone (máscara BR), CPF (validado), data, lista de opções (uma),
caixas (várias), menu suspenso, **aceite de termo** (checkbox obrigatório com texto longo), **envio de arquivo**
(imagem/PDF), título/texto informativo (sem resposta), separador de seção.
Depois: unidade/turma/graduação do próprio grupo (listas do GingApp), categoria/faixa etária calculada pela data de
nascimento, assinatura simples, campo condicional (`showIf`), escala/avaliação.

### Modelos prontos (acelera o cadastro)

"Campeonato" (como o do Varjão: dados do competidor, apelido, nascimento, graduação, grupo/professor, categoria,
termo de responsabilidade, pagamento), "Batizado/troca de corda", "Curso/oficina", "Roda/encontro", "Inscrição simples".
O Mestre duplica e ajusta. **Duplicar formulário** de um evento anterior também entra.

## 5. Pagamento (a decisão mais importante)

Duas rotas, escolhidas por formulário:

- **PIX_MANUAL (MVP, igual ao Forms de hoje)**: a página mostra a chave Pix/QR estático do grupo, o valor e o campo de
  comprovante (upload). O Mestre confere o comprovante na tela de inscrições e clica "Pagamento confirmado". Funciona
  para qualquer grupo, sem Mercado Pago.
- **PIX_AUTO (Mercado Pago, já integrado)**: ao enviar, gera-se um Pix dinâmico **na conta Mercado Pago do grupo**; o
  webhook confirma e a inscrição vira CONFIRMADA sozinha; o inscrito recebe a confirmação. Sem comprovante, sem conferência.
  **Trabalho técnico**: hoje a cobrança do Pix está presa a `FinancialRecord` (mensalidade de aluno). Para inscrição de
  gente de fora é preciso **generalizar o Pix para um "alvo cobrável"** (registro financeiro OU inscrição) reaproveitando
  provedor, webhook, reconciliação, idempotência e travas já auditadas, em vez de duplicar. Recomendo um refactor
  pequeno e testado (interface `Chargeable`) como parte da Fase 2.

Regras comuns: valor **sempre do servidor** (nunca do navegador); desconto/isenção opcional por código (Fase 3);
inscrição "sem pagamento" para eventos gratuitos; reembolso é manual e registrado (não automático).

## 6. Segurança, LGPD e abuso (formulário público é alvo de spam e vazamento)

1. **Antispam**: rate limit por IP e por formulário, honeypot, tempo mínimo de preenchimento e, opcional por formulário,
   **CAPTCHA** (Cloudflare Turnstile/hCaptcha). Bloqueio de duplicidade por CPF/e-mail no mesmo formulário.
2. **Arquivos privados**: comprovantes e documentos **nunca** ficam em `/uploads` público. Armazenamento privado, validação
   de tipo real (magic bytes), limite de tamanho, nome aleatório, e entrega ao Mestre por URL autenticada/assinada com
   expiração. Sem execução de conteúdo; avaliar antivírus se o volume justificar.
3. **Dados pessoais**: CPF com hash + criptografia (mesmo padrão da ficha), resposta em JSON **sem** logar conteúdo,
   acesso só do Mestre/quem tiver permissão, **auditoria** de visualização/exportação, política de retenção (apagar
   respostas e anexos X dias depois do evento) e atendimento a pedido de exclusão.
4. **Menores de idade**: pergunta de nascimento aciona campos do **responsável** e termo de autorização.
5. **Consentimento**: texto de privacidade e finalidade na própria página, com aceite registrado (data, versão do texto).
6. **Resposta constante** nos erros públicos (não revelar se um CPF/e-mail já está inscrito além do necessário).
7. **Não confiar no cliente**: validação completa no servidor; lógica condicional reavaliada no servidor.

**Como ficou depois da auditoria adversarial da F1 (2026-10-18, `PLANO_PROJETO.md` 10.65):**

1. **E-mail ao inscrito** (o envio é anônimo; o e-mail informado pode ser de outra pessoa): só protocolo + título do
   formulário (do Mestre, escapado) + situação, saudação fixa "Olá!", **nunca** texto digitado pela pessoa (nem o nome).
   Teto quando quem dispara é o envio anônimo: 3 por endereço normalizado em 24 h (em qualquer formulário) e 100 por
   formulário/hora, contados nas próprias inscrições (persistente). Ações do Mestre sempre avisam.
2. **Disco/anexos** (anônimo): tetos de pendentes por formulário (200), por IP + formulário (10) e de bytes pendentes por
   grupo (500 MB), contando também os expirados que ainda estão no disco; limpeza dos pendentes expirados **a cada 15 min**;
   varredura semanal disco x banco; imagens regravadas **sem EXIF/GPS** (sharp); limite por arquivo no máximo 9 MB.
3. **Flood de linhas/vagas**: teto de inscrições por IP + formulário (5/h, 20/dia), `answers` até 64 KB, lista de espera com
   teto (200 ou as vagas), tempo de preenchimento pelo **relógio do servidor** (`startedToken` HMAC do GET; o `startedAt`
   do navegador só no modo de transição `FORMS_PUBLIC_LEGACY`). IPv6 contado por /64 nos limites e no `ipHash`.
4. **Ficha do aluno**: o envio anônimo **nunca** liga a ficha nem altera uma participação que já existia no evento; CPF de
   aluno ativo vira só **sugestão** (`suggestedStudentId`); o vínculo é do Mestre (`linkStudentId` ao aprovar/confirmar).
   Confirmar respeita `Event.capacity` (lotado = 409, ou lista de espera no envio automático).
5. **Duplicidade**: e-mail normalizado (minúsculas, sem `+tag`; Gmail/Googlemail sem pontos) e CPF só dígitos. Modelos
   sem e-mail/CPF (RODA) não têm checagem de duplicidade. O 409 `ALREADY_REGISTERED` revela que o CPF/e-mail já se
   inscreveu naquele formulário: **risco aceito** (UX), limitado pelos tetos por IP e pelo throttle.
6. **LGPD**: titular sem conta = o Mestre anonimiza a inscrição no painel (mesma rotina da retenção e do pedido de
   exclusão, inclusive o nome copiado para o participante do evento); retenção também para formulário sem data de
   encerramento (envio + N meses); `dry-run` continua o padrão do código, com aviso no boot e no resumo do painel; texto
   padrão do termo diz "serão apagados ou anonimizados" e "solicite ao organizador"; snapshot SHA-256 + texto de cada
   versão do termo efetivo (texto + aceites) e 409 `CONSENT_OUTDATED` quando a versão exibida não é a vigente.
7. **Menores**: CAMPEONATO e BATIZADO perguntam "O participante é menor de 18 anos?" e, se Sim, exigem nome, CPF, telefone,
   parentesco e a autorização do responsável; uso de imagem é aceite **separado e opcional**.
8. **Permissões**: CSV, anexo, confirmar pagamento e anonimizar só o MESTRE; listar é auditado; quem não é Mestre vê o
   detalhe sem anexos. Trocar o evento de um formulário com inscrições confirmadas = 409 `FORM_HAS_CONFIRMED`.
9. **Chave Pix**: fica pública enquanto o formulário está aberto; orientar o Mestre a usar chave **aleatória**.

## 7. Experiência pública e compartilhamento

- URL curta e legível: `https://app.gingapp.com.br/i/<slug>` (ou subdomínio dedicado, ver decisões). Funciona **sem
  login**; se a pessoa já está logada como aluno, **pré-preenche** com os dados da ficha ("inscrever-me") e liga a
  inscrição à pessoa.
- **Pré-visualização no WhatsApp/Instagram**: o link precisa mostrar banner + título (tags Open Graph). Uma SPA pura
  não entrega isso; é preciso o backend (ou um pequeno servidor de borda) responder o HTML com as meta tags para
  `/i/<slug>`. Isto é requisito do MVP, porque o link será compartilhado principalmente no WhatsApp.
- Banner/capa e cores do grupo; botão "Compartilhar"; QR Code do link para cartaz impresso.
- Tela de sucesso com protocolo, instruções de pagamento e botão "Salvar/Imprimir comprovante de inscrição";
  consulta posterior por protocolo + e-mail/CPF (status da inscrição).
- Acessibilidade e mobile-first (a maioria abrirá no celular).

## 8. Gestão das inscrições no painel

Nova aba **"Inscrições"** dentro do evento (e atalho no menu):

- Tabela com busca, filtros (status, pagamento, categoria, data), contadores (total, pagos, pendentes, vagas restantes).
- Abrir inscrição: respostas, anexos (visualizar comprovante), histórico, nota interna.
- Ações: confirmar pagamento, aprovar, recusar (com motivo), cancelar, mover para lista de espera, reenviar instruções.
- **Vagas e lista de espera** (reusa `capacity`): ao liberar vaga, promover o próximo da espera e avisar.
- Aviso em massa aos inscritos (WhatsApp com mensagem pronta / e-mail / notificação para quem tem app).
- **Exportar CSV/XLSX** (colunas dos campos do formulário) e imprimir **lista de presença/credenciamento**.
- Confirmada a inscrição, cria/atualiza `EventParticipant` (check-in no dia já funciona).
- Formulário: abrir/fechar manualmente, encerrar no prazo, limite de respostas, duplicar, arquivar.

## 9. Funcionalidades específicas de campeonato (fase posterior)

Categorias por idade/graduação/gênero com **sugestão automática**, tabela de inscritos por categoria, **chaveamento**
(solo e duplas), súmula e resultados, certificados de participação (o GingApp já emite certificados), ranking do grupo
alimentado por resultados. É um produto à parte e só vale depois do núcleo estar em uso.

## 10. Fases, entregáveis e esforço relativo

| Fase | Entrega | Esforço |
|---|---|---|
| **F0 – Decisões** | Responder as perguntas da seção 12; desenhar 3 telas (construtor, página pública, lista de inscrições). | P |
| **F1 – MVP "substitui o Forms"** | Modelo de dados + migration; construtor (campos MVP, seções, ordem, obrigatório, termo, arquivo); página pública com Open Graph; envio com validação no servidor e antispam; upload privado de comprovante; **Pix manual**; lista de inscrições com aprovar/recusar/pagamento confirmado; exportar CSV; notificação ao Mestre; vagas/prazo; auditoria e LGPD básica. | **G** |
| **F2 – Pix automático e vida real** | Generalizar o Pix para "alvo cobrável" (inscrição); Pix dinâmico + webhook + baixa automática; e-mail/WhatsApp de confirmação; lista de espera com promoção automática; pré-preenchimento para aluno logado; consulta por protocolo. | M-G |
| **F3 – Produtividade** | Modelos prontos, duplicar de evento anterior, lógica condicional simples (`showIf`), categoria por idade, código de desconto/isenção, QR do link, estatísticas (visitas x inscrições), CAPTCHA opcional, importar CSV do Google Forms (migrar as respostas antigas). | M |
| **F4 – Campeonato** | Categorias, chaveamento, resultados, certificados e ranking. | G |

Cada fase fecha com o **gate** de sempre (lint, tsc, testes, build; backend `test:quick`) e **auditoria adversarial** na
parte de dinheiro (F2) e de dados pessoais/arquivos (F1), como foi feito no Pix de mensalidade.

## 11. Estratégia de testes (simples e rápidos, como combinado)

- Backend e2e curtos: criar formulário, validar cada tipo de campo, envio público feliz e com erro, antispam/limites,
  duplicidade, vagas/lista de espera, upload privado (tipo/tamanho/acesso só do Mestre), isolamento entre grupos,
  permissões (só quem gerencia eventos), pagamento manual, e (F2) Pix automático com o provedor simulado.
- Painel/app: construtor (adicionar/reordenar/remover campo, obrigatório), página pública (validação, mensagens,
  sucesso), tela de inscrições (filtros, ações).
- Visual a 375 px (a página pública é mobile-first).

## 12. Decisões

**Decididas pelo dono (2026-10-18):**

1. **Pagamento no MVP**: **Pix manual primeiro** (chave Pix do grupo + comprovante + conferência do Mestre); o Pix
   automático Mercado Pago entra na **F2**, depois do refactor do Pix para "alvo cobrável" e da auditoria.
2. **Endereço do link**: **`https://app.gingapp.com.br/i/<slug>`** (domínio que já existe; sem DNS/serviço novo).

**Em aberto — padrão recomendado (valem se o dono não disser o contrário):**

3. **Quem cria/gerencia formulários**: só o **Mestre** (e quem tiver a permissão de gerenciar eventos na matriz).
   _Pós-auditoria:_ quem gerencia eventos lista/vê/aprova/recusa; **só o Mestre** exporta CSV, abre comprovantes,
   confirma pagamento e anonimiza.
4. **Inscrição exige login?** **Não** (anônima, como o Forms), com pré-preenchimento para quem estiver logado.
   _Pós-auditoria:_ por ser anônima, o CPF nunca liga a ficha sozinho (só sugestão; o Mestre confirma o vínculo).
5. **Aprovação**: configurável **por formulário**; padrão = o Mestre confirma o pagamento e a inscrição vira confirmada.
   _Pós-auditoria:_ confirmar respeita as vagas do evento ligado; recusar/cancelar com pagamento pendente deixa de cobrar
   (`NOT_REQUIRED`; pagamento já confirmado fica registrado).
6. **Retenção de dados**: **12 meses** depois do evento, configurável; depois apaga respostas e anexos.
   _Pós-auditoria:_ formulário sem data de encerramento conta da data de cada envio; o job fica em `dry-run` até o dono
   ligar `FORMS_RETENTION_PURGE=true` em produção (aviso no boot e no painel).
7. **Importar as respostas antigas** (as 95 do Varjão): **F3** (CSV exportado do Google Planilhas).
8. **CAPTCHA**: **não** no MVP (limites + honeypot + duplicidade bastam para começar); opcional na F3, quando houver chave do
   provedor (Turnstile/hCaptcha). _Pós-auditoria:_ limites por IP (/64 no IPv6) + `startedToken` do servidor + tetos de
   disco/linhas/e-mail; CAPTCHA continua fora (decisão a rever se houver abuso real).

## 13. Riscos

- **Spam/abuso** do link público (mitigado por limites, honeypot, CAPTCHA opcional, duplicidade).
- **Vazamento de dados pessoais/comprovantes** (mitigado por armazenamento privado, criptografia, auditoria, retenção).
- **Dinheiro**: o Pix automático de inscrição reaproveita o módulo auditado, mas o refactor para "alvo cobrável" precisa de
  nova auditoria independente antes de uso com dinheiro real; e continua pendente validar o Mercado Pago em sandbox.
- **Escopo inflando** (querer todos os recursos do Forms): manter o MVP nos campos listados e medir o uso antes da F3/F4.
- **Pré-visualização do WhatsApp** depende de servir meta tags no servidor (sem isso o link aparece "feio").

## 14. Critérios de aceite do MVP (F1)

1. O Mestre cria um formulário no painel com seções e os campos do MVP, em até ~10 minutos, a partir de um modelo.
2. Recebe um link público que abre no celular sem login e mostra banner/título no WhatsApp.
3. Uma pessoa de fora se inscreve, aceita o termo, anexa o comprovante e recebe um protocolo.
4. O Mestre vê a inscrição, abre o comprovante, confirma o pagamento e a pessoa vira participante do evento.
5. O Mestre exporta as inscrições em CSV e vê o saldo de vagas; passado o prazo/limite, o link informa "inscrições encerradas".
6. Nenhum comprovante ou dado pessoal é acessível sem autenticação; todas as ações de dados pessoais ficam na auditoria.
7. Testes e gate verdes.
