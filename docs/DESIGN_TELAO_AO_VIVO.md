# DESIGN — Telão ao vivo "transmissão esportiva" (refino visual, fase 1: telão público)

Estado: decisões do dono em 2026-11-11 — telão primeiro (painel depois), direção **transmissão esportiva**, prioridades: **animações do vencedor e da luta ao vivo**, **tela de campeão e pódio**, **detalhes de acabamento**. O comportamento, os dados e a conexão NÃO mudam (contrato `CONTRATO_CHAVEAMENTO.md` §5/§7 continua valendo; backend intocado).

## 1. Linguagem visual
- **Palco escuro** (modo padrão do telão; `?tv=1` e página normal): fundo quase preto azulado (~`#070B14`) com gradiente radial discreto e uma textura sutil (grade fina ou ruído a 3–4% de opacidade, SEM imagem pesada). Verde da marca GingApp como acento principal; **dourado** reservado ao campeão/1º lugar; vermelho SÓ para "AO VIVO".
- **Tipografia de placar:** fonte condensada em caixa alta para nomes e títulos (ex.: Barlow Condensed 600/700 ou equivalente), numerais tabulares para placar. Fontes **autoistaladas** (pacote `@fontsource/*`, versão EXATA publicada há >14 dias, carregadas só no chunk do telão, `font-display: swap`) — nada de Google Fonts/CDN externo (LGPD e rede de ginásio ruim). Fallback: pilha condensada do sistema.
- **Cartão de atleta:** avatar circular com anel na cor do grupo (matiz estável pelo nome do grupo), nome em caixa alta condensada, grupo e graduação em linha secundária; vencedor ganha brilho verde + marca de vitória; perdedor esmaece (opacidade/saturação) mas continua legível.
- **Cabeçalho tipo emissora:** título do evento, nome do grupo organizador, selo **AO VIVO** pulsante (vermelho), rodada atual ("Final", "Semifinais"…), relógio opcional discreto, indicador de conexão sem chamar atenção.
- **Nomes de rodada em português:** Final, Semifinais, Quartas de final, Oitavas de final, 1ª rodada (e "Disputa de 3º lugar"); em grupos: "Grupo A", "Grupo B"…; cabeçalho de coluna na chave.
- **Contraste AA** em tudo; status NUNCA só por cor (texto/ícone também). Textos mínimos legíveis a 3 m de uma TV 1080p (corpo ≥ 20 px no `tv`).

## 2. Animações (alma do pedido)
Todas com `transform`/`opacity` (TV fraca!), ≤ ~1,2 s por evento comum, sem bloquear a leitura, e **desligadas/simplificadas com `prefers-reduced-motion`** (vira só mudança de cor/destaque). Disparam por **diferença entre snapshots** (o primeiro snapshot NUNCA anima) — reaproveitar `snapshot-diff.ts` (estender, sem quebrar).
1. **Abertura de luta (VS intro):** quando uma luta vira LIVE, no modo `tv` aparece por ~3,5 s uma faixa/overlay "VS": os dois atletas entram deslizando dos lados com foto grande (ou iniciais), nome, grupo, graduação, tatame e rodada; fundo com varredura de luz. Fila (no máximo 1 por vez; se chegarem várias, mostra a mais recente e descarta as velhas). Fora do `tv`: só a faixa AGORA existente, mais bonita.
2. **Luta ao vivo na chave:** cartão com borda luminosa pulsante (suave), selo AO VIVO, tatame; as próximas lutas com contagem "PRÓXIMA".
3. **Resultado:** no cartão: "flash" de vitória, vencedor sobe de brilho, perdedor esmaece, placar dá um "pop" numérico; em seguida **o vencedor atravessa a chave** até a próxima luta (linha que se desenha com rastro luminoso + miniatura do atleta viajando) e o slot de destino recebe o atleta com um encaixe (escala/brilho). Já existe versão simples — refinar, não reescrever do zero.
4. **Entrada da categoria e transições:** ao trocar de categoria, cartão-título curto (nome da categoria + "Adulto até 70 kg · Eliminatória") com cross-fade/slide de ~0,6 s; cartões da chave entram em stagger leve na 1ª carga.
5. **Estados de espera:** skeleton com shimmer coerente com o tema; "Chave ainda não sorteada" com ilustração/ícone simples e animação lenta (respirar).

## 3. Tela de campeão e pódio (momento de glória)
- Dispara na **transição** de uma categoria para FINISHED (nunca na 1ª carga). No `tv`: overlay de comemoração ~12 s e depois assenta numa tela de **pódio permanente**; fora do `tv`: bloco de destaque no topo da categoria + pódio.
- **Campeão:** holofote dourado atrás, foto grande (ou iniciais) com anel dourado e coroa/troféu (SVG simples), nome em tipografia gigante, grupo e graduação; contador "CAMPEÃO" com revelação em camadas.
- **Pódio 1º/2º/3º:** três blocos que "sobem" em stagger (2º, 3º, depois 1º), cada um com foto, nome, grupo; dois 3º lugares quando não há disputa de 3º. Medalhas simples em SVG (ouro/prata/bronze).
- **Confete:** canvas leve (≤ 150 partículas, sem biblioteca nova se der; para e libera o canvas ao fim), cores ouro + verde + branco; rajada inicial e chuva suave; `requestAnimationFrame` cancelado ao desmontar e quando a aba fica oculta.
- Com `reduced-motion`: sem confete/subida; pódio estático com destaque dourado.

## 4. Acabamento
- Ícones SVG próprios e consistentes (troféu, coroa, relógio, tatame, tela cheia, QR), sem emoji. Estados de carregamento, erro, "reconectando", "indisponível" e vazio com a MESMA linguagem (logo GingApp discreto).
- Chave grande: melhor uso da tela cheia (menos margens mortas no `tv`), piso de escala maior (hoje cai a 0,15 e fica ilegível): em chaves enormes, **paginar por metade/quadrantes com zoom automático na luta ativa** em vez de encolher tudo; manter geometria pura testada.
- Grupos: grade de tabelas de classificação legível (destaque dos classificados), mini-chave do mata-mata ao lado; sem `overflow: hidden` cortando conteúdo (rolar ou paginar com rodízio).
- Foto: `object-fit: cover`, fallback de iniciais com gradiente do grupo; nunca imagem quebrada.
- Cursor oculto, wake lock e tela cheia continuam.

## 5. Restrições técnicas
- Alterar SÓ `app.gingapp.com.br` (componentes/lib/css do telão, rota, testes, dependências de fonte). Sem backend/painel/admin. Sem mudar o contrato de dados.
- Reaproveitar `motion` (14.6.0 já instalada). Qualquer dependência nova: versão exata, >14 dias, só no chunk do telão; informe tamanho do chunk (meta: não passar de ~+60 kB gzip no total do telão; o chunk principal NÃO pode crescer).
- Desempenho: testar com CPU throttle 4× no navegador; sem blur grande em áreas amplas, sem sombras pesadas animadas; `will-change` só durante a animação.
- Privacidade inalterada (só campos do snapshot público; foto nula => iniciais).
- Testes existentes continuam verdes; novos testes para: diferença de snapshots (VS intro/campeão disparam só na transição), fila de intros, nomes de rodada, paginação da chave grande, reduced-motion, cancelamento de rAF/timers ao desmontar.

## 6. Entrega visual (obrigatória)
O agente DEVE rodar o telão no navegador (dev server + mock local que serve os snapshots REAIS e simula a progressão: sorteio → luta ao vivo → resultado → campeão), tirar capturas e iterar pelo menos 2 rodadas de autocrítica. Capturas em `D:\tmp\telao-shots\` (1920×1080 `tv`; 1280×720; 375×812): chave single em andamento, VS intro, luta ao vivo, vencedor avançando (2 quadros), grupos, campeão (overlay) e pódio, indisponível, carregando.

## 7. Execução — refino visual do telão (2026-11-11)

Estado: **concluído** (telão público; painel e admin continuam como estavam). Artefatos: componentes/lib/css em `app.gingapp.com.br/src/{components,lib}/chaveamento/`, testes `src/test/chaveamento-visual-lib.test.ts` e `chaveamento-visual-page.test.tsx`, dependência `@fontsource/barlow-condensed@5.3.0`.

### Decisões e o que foi feito
1. **Linguagem de transmissão**: palco escuro nas duas telas (normal e `?tv=1`), Barlow Condensed 700/800 autoinstalada (só no chunk do telão), cartão de atleta com anel na cor do grupo (matiz estável pelo nome do grupo, faixa verde→magenta; sem vermelho/laranja/dourado), cabeçalho de emissora (marca, fase atual, AO VIVO, relógio no `tv`), nomes de rodada em português (Final, Semifinais, Quartas, Oitavas, 16/32 avos, "1ª rodada" só em chaves de 6+ rodadas).
2. **Animações** (só `transform`/`opacity`): abertura "VS" (só `tv`, 3,5 s, fila de 1 + 1 pendente, a mais recente vence); luta ao vivo com halo pulsante e selo; resultado com flash, "pop" no placar, perdedor esmaecido, vencedor com rastro luminoso e encaixe no cartão seguinte; entrada de categoria (cartão-título + slide). Disparo por **diferença de snapshots** (`snapshot-diff.ts` ganhou `intros`; `started` ficou intacto).
3. **Campeão e pódio**: tela de campeão de 12 s só na transição para FINISHED (nunca na 1ª carga), pódio permanente com blocos subindo (2º, 3º, 1º), medalhas SVG, dois 3º quando não há disputa, confete em canvas (≤150 partículas, rAF cancelado ao desmontar e com aba oculta). Movimento reduzido: sem VS, sem overlay, sem confete, pódio estático.
4. **Chave grande**: em vez de escala 0,15, o telão divide a chave em **páginas por janela de 3 rodadas** (subárvores recortadas, sobrepostas em 1 coluna, terminando na "Fase final" com a disputa de 3º) e fica na página da luta ao vivo (zoom automático); piso de legibilidade `TV_MIN_SCALE = 0,95`. Geometria pura em `bracket-pages.ts`, testada para N = 2..128 (sem sobreposição, todas as lutas cobertas, escala >= 0,95).
5. **Grupos/rodadas**: `PagedGrid` mede a área, pagina e confere pela altura real renderizada (nada cortado, sem `overflow: hidden` escondendo conteúdo); classificados marcados (✓ + texto para leitor de tela) só depois que o mata-mata existe.

### O que deu certo / o que não deu / solução
- Deu certo: o mock local com os snapshots reais (`D:\tmp\telao-mock`) + captura por DevTools Protocol expôs problemas que teste de jsdom não vê (orçamento vertical do `tv`, tabelas sobrepostas, pódio vazando do painel).
- Não deu certo (1ª tentativa): páginas "metade/quadrante + fase final única" — a página final crescia 2^d e a escala caía de novo. Solução: janelas de rodadas sobrepostas (cada página tem no máx. 2^(H-1) lutas na 1ª coluna).
- Não deu certo: `key` duplicada entre a tela de campeão e o confete (mesmo `seq`) deixava uma tela de campeão fantasma depois dos 12 s. Achado por teste; chaves agora têm prefixo (`champion-`, `confetti-`, `vs-`).
- Pegadinha de ambiente: o Chrome desta máquina reporta `prefers-reduced-motion: reduce`; as capturas de animação exigem emular `no-preference` (o app obedeceu ao sistema, como deve).

### Pendências
1. Conferir em TV/tablet/celular reais e no Safari (nada disso foi visto).
2. "Rodízio automático" deixou de mostrar texto no cabeçalho do `tv` (espaço); só aparece "Retomar rodízio" quando pausado.

## 8. Execução — experiência do espectador no celular (2026-11-12)

Foco: quem acompanha pelo link público (`/ao-vivo/<token>`, QR da TV ou WhatsApp) no PRÓPRIO celular, na arquibancada (4G ruim, sol, bateria baixa). O modo TV (`?tv=1`) não foi alterado (só `font-size` mínimo de 12 px nas iniciais do avatar). Tudo abaixo vale só no modo normal.

### Regras de layout (verificadas por medição em 15 viewports, 280 a 1920 px, e por captura)
1. **Nada alarga a página**: a rolagem horizontal só existe DENTRO da chave, dos chips das categorias, do carrossel de lutas ao vivo e das tabelas de grupos. `scrollWidth <= clientWidth` em todos os estados medidos.
2. **Cabeçalho compacto** no celular em pé (grade: marca + organizador + selo AO VIVO + compartilhar; título embaixo, até 2 linhas); data/local seguem no DOM (leitor de tela). Sem QR (só em tela grande com mouse); "Tela cheia" some no celular em pé. Em paisagem o cabeçalho divide a linha com a busca.
3. **Faixas fixas ≤ 20% da altura em paisagem**: em pé, chips (56 px) + legenda de rodadas (44 px); em paisagem baixa só a legenda (44 px).
4. **Chips das categorias** (44 px, fade nas bordas que ainda têm conteúdo, categoria escolhida centralizada, "AO VIVO" escrito + ponto), sticky.
5. **Chave**: legenda de rodadas sticky (sincronizada com a rolagem horizontal por `transform`, sem estado React), encaixe por rodada (`scroll-snap`), botões −/ajustar/+ (zoom 0,3 a 2), `touch-action: pan-x pan-y pinch-zoom` (o pinça nativo continua livre e o gesto vertical rola a página), toque num atleta acende o caminho dele (cartões fora dele esmaecem), botão flutuante "Ir para a luta ao vivo"/"Ir para a final". A partir de 48 cartões (128 atletas = 127 lutas) só os cartões perto da tela são desenhados (`bracket-window.ts`).
6. **AGORA/PRÓXIMAS**: o cartão AGORA empilha os lutadores quando o cartão é estreito (container query, vale também no tablet), várias lutas ao vivo viram carrossel, no máximo 2 próximas no celular em pé, nomes em 2 linhas.
7. **Tabelas de grupos**: rolagem horizontal interna, rank e nome fixos à esquerda; em 320 px a coluna L (= V+E+D) sai para os pontos ficarem à vista.
8. **Textos**: secundário >= 12 px, nome do atleta no cartão >= 14 px (16,5 px no zoom padrão), alvos de toque >= 44 px, nada só por cor (ícone/texto).
9. **Área segura e viewport**: `viewport-fit=cover` e `theme-color` escuro só enquanto a página está montada (`page-chrome.ts`; o `index.html` é do app inteiro), `env(safe-area-inset-*)`, `svh`/`dvh`, `-webkit-tap-highlight-color`.

### Acompanhar meu atleta, links e compartilhar
- Campo "Buscar atleta ou grupo" (`athlete-search.tsx` + `lib/chaveamento/athlete-search.ts`): acha por nome ou grupo (sem acento), rola até a luta, acende o caminho; faixa "Minha próxima luta" só com luta ao vivo ou já definida. **Única coisa guardada**: o TEXTO digitado, em `sessionStorage` (`gingapp:ao-vivo:busca`), com try/catch. Nenhum dado de atleta vai para storage; o último placar fica só em memória (`use-live-tournament.ts`).
- Links: `?categoria=<id>` abre na categoria (id inexistente é ignorado em silêncio) e `?q=<texto>` pré-busca (só texto, até 60 caracteres, nunca HTML). A URL acompanha a categoria com `history.replaceState` (sem empilhar histórico, preserva `tv`; o rodízio automático do telão não mexe na URL). O painel pode gerar `…/ao-vivo/<token>?categoria=<id>`.
- Botão "Compartilhar" (`navigator.share`, com fallback para copiar o link e aviso "Link copiado"); leva a categoria que está na tela. O QR do telão leva ao campeonato todo.

### Bateria e dados (crítico para quem fica horas)
- `connection.ts`: aba/app OCULTO ou aparelho OFFLINE = EventSource fechado e nenhum timer de pé; o último snapshot continua na tela. Ao voltar: consulta imediata (`If-None-Match`) + SSE reaberto. Offline mostra a faixa "Sem conexão — mostrando o último placar". Consulta que falha recua 3 s -> 6 -> 12 -> 24 -> 30 s e volta a 3 s no primeiro sucesso (mudança de especificação: antes era fixo em 3 s).
- Animações infinitas pausam com a aba oculta (`data-hidden`); a varredura de luz do AGORA não roda fora do telão; `prefers-reduced-motion` segue desligando tudo; rodízio, relógio e confete não deixam timer/rAF de pé em oculto.
- Aviso de reconexão só aparece depois de 3 s (queda curta não pisca); sem rede avisa na hora.

### O que deu certo / o que não deu / solução
1. Cabeçalho de 230 px (390x844) e título em 6 linhas (768): -> grade compacta (87 px) e título com espaço próprio.
2. Chave abaixo da dobra (103% da altura em 390x844): -> busca compacta, AGORA empilhado, PRÓXIMAS no máximo 2: a legenda da chave aparece em ~73%.
3. Overflow horizontal (+15 px em grupos/campeão/sem sorteio): a causa eram o pódio com `min-width`, a tabela e o esqueleto; corrigidos. Texto só para leitor de tela (`sr-only`) dentro de `overflow:hidden` alargava a página em paisagem (+19 px): o contêiner agora é `position:relative`.
4. `.cv-next-list` em coluna com `flex-wrap: wrap` alargava a linha (191 px numa lista de 149 px): `nowrap` no celular.
5. CLS 0,02 a 0,04 (cabeçalho compacto): vem da troca de fonte (Barlow Condensed chega depois do primeiro placar e o nome do atleta cabe em 1 linha em vez de 2). Tentamos baixar a fonte já no esqueleto (CLS 0), mas na Slow 4G o primeiro placar atrasou ~0,7 s: revertido, vale mais o conteúdo cedo (CLS segue "bom", < 0,1).
6. INP ~320 ms ao trocar de categoria com CPU 4x: o desenho da chave nova passou para `useDeferredValue` (o chip acende na hora): ~130-170 ms.
7. O pacote principal do app crescia 0,3 kB porque `search.ts` era compartilhado com o componente: os links profundos foram para `live-search.ts` (só no pacote do telão); a rota continua validando só `?tv=1` e o componente lê `categoria`/`q` da URL (o roteador não reescreve a URL: verificado no navegador).
8. O QR não é mais nem montado no celular (`useMediaQuery`), o relógio do telão não deixa timer de pé em aba oculta e o confete usa metade das partículas em tela estreita.

### Tamanhos (build de produção)
| pacote | antes | depois |
| --- | --- | --- |
| principal do app (`index-*.js`) | 335,43 kB / 104,99 kB gzip | 335,44 kB / 105,01 kB gzip |
| telão JS (`ao-vivo._token-*.js`) | 144,15 kB / 48,55 kB gzip | 166,45 kB / 55,30 kB gzip |
| telão CSS (`ao-vivo-*.css`) | 34,86 kB / 7,38 kB gzip | 59,38 kB / 11,27 kB gzip |

### Desempenho (Chrome emulado, 390x844, CPU 4x, Slow 4G 1,6 Mbps/150 ms, cache e service worker desligados, mediana de 3 cargas frias)
| | antes (HEAD) | depois |
| --- | --- | --- |
| FCP (esqueleto) | 2,2 s | 2,3 s |
| LCP / primeiro cartão | 2,9 s | 2,9 s |
| CLS | 0 | 0,02 |
| INP (toque num chip de categoria) | ~216 ms | ~128 ms |
| TBT aproximado | ~420 ms | ~270 ms |
Chave de 128 atletas (CPU 4x, rolando a página toda): 25 cartões desenhados (de 127), 861 nós de DOM, p95 de quadro 20 ms, nenhuma tarefa longa (> 50 ms).

### Pendências
1. Celular físico, iOS/Safari, notch real e rede real não foram testados (só emulação do Chrome: toque, viewport, CPU 4x, Slow 4G, offline, visibilidade).
2. Pinça personalizada na chave não foi feita: o pinça nativo do navegador funciona sobre a chave (medido) e o zoom da chave usa os botões.
