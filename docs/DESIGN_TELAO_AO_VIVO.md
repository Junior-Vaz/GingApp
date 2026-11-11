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
