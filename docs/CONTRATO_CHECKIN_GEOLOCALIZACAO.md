# Contrato — Check-in por geolocalização (aluno registra a própria presença)

Fonte única entre backend (`backend/src/interface/http/attendance/*`, `classes/*`), painel (turma + chamada) e app (aluno).
Em caso de dúvida este documento vence; divergência = avisar, não adivinhar.

## 1. Ideia
A TURMA pode ter o "check-in por localização" ligado (padrão **desligado**). Com ele ligado, o aluno (ou o responsável por um
dependente) toca em "Estou aqui" no app, o aparelho envia a posição, e o servidor confere se está a até **R metros** do local
da turma, dentro da **mesma janela de horário do check-in por QR** (2 h antes do início até 2 h depois do fim da aula) e se o
aluno está matriculado ativo na turma. Dando certo, grava presença como o check-in por QR (mesma notificação, Ginga Rank e
auditoria). O professor continua podendo ajustar a chamada depois.

## 2. Turma (backend + painel)

Prisma (migration `20261104000000_class_geo_checkin`, escrita à mão, sem BOM):
- `Class.geoCheckinEnabled Boolean @default(false)`
- `Class.geoCheckinRadiusMeters Int @default(150)` (faixa 50..500)
- `enum AttendanceSource { QR GEO }` e `Attendance.checkinSource AttendanceSource?` (nulo = chamada manual do professor; o
  check-in por QR existente passa a gravar `QR`; o novo grava `GEO`). Um check-in que só CONFIRMA uma presença já existente
  não troca a origem. Se o professor marcar/ajustar a chamada manualmente depois, `checkinSource` volta a `null`.

Local da turma (SSOT já existente): coordenadas PRÓPRIAS da turma (`Class.latitude/longitude`) se houver, senão as da UNIDADE
(`Unit.latitude/longitude`); sem nenhuma = sem local.

DTOs/respostas de turma (criar, editar, ler, listar — onde hoje devolve os campos da turma) ganham:
```ts
geoCheckinEnabled: boolean;            // escrita opcional (Mestre/Professor que já editam a turma)
geoCheckinRadiusMeters: number;        // 50..500 inteiro; escrita opcional
geoCheckinLocation: 'CLASS' | 'UNIT' | null;   // SÓ LEITURA: de onde vem o local (null = sem local)
```
Regra: ligar (`geoCheckinEnabled=true`) exige local (turma ou unidade) — senão **400** com `code: 'GEO_CHECKIN_NO_LOCATION'` e
mensagem "Defina o local da turma (ou da unidade) antes de ligar o check-in por localização.". Idem se uma edição que remove o
local deixaria a turma ligada sem nenhum local. Campo fora da faixa = 400 (validador padrão).

## 3. Rotas do aluno (token do grupo; `MEMBER` autenticado; aluno ou responsável)

`GET /attendance/geo-checkin/available` → `GeoCheckinOption[]`:
```ts
interface GeoCheckinOption {
  lessonId: number; studentId: number; studentName: string;
  className: string; date: string /* ISO */; startTime: string | null; endTime: string | null;
  opensAt: string; closesAt: string;          // janela (ISO)
  radiusMeters: number;
  alreadyCheckedIn: boolean;                  // presença já registrada
}
```
Lista, para o usuário e seus dependentes ATIVOS: aulas ATIVAS cuja turma tem o check-in por localização ligado, com local
definido, o aluno matriculado ATIVO, **agora dentro da janela**. NUNCA devolve coordenadas. Vazia = nada disponível.

`POST /attendance/geo-checkin` body (whitelist; campo extra = 400):
```ts
{ lessonId: number; latitude: number /* -90..90 */; longitude: number /* -180..180 */;
  accuracyMeters?: number /* 0..100000 */; studentId?: number }
```
Sucesso **200** `{ lessonId, studentId, present: true, alreadyCheckedIn: boolean, distanceMeters: number }` (distância arredondada
ao metro). Idempotente (já presente = `alreadyCheckedIn: true`, 200). Erros (todos com `code` + `message` em português):
| Situação | Status | code |
|---|---|---|
| aula de outro grupo/inexistente | 404 | — (igual às outras rotas) |
| aula cancelada | 409 | `LESSON_CANCELLED` |
| fora da janela | 409 | `OUTSIDE_WINDOW` (mensagem como a do QR) |
| turma com check-in por localização desligado | 403 | `GEO_CHECKIN_DISABLED` |
| turma/unidade sem local agora | 409 | `GEO_NO_LOCATION` |
| `accuracyMeters` informado > max(100, raio) | 400 | `GEO_ACCURACY_LOW` ("Sinal de GPS fraco. Vá para um lugar aberto e tente de novo.") |
| longe: distância > raio | 403 | `GEO_TOO_FAR`, corpo extra `distanceMeters`, `radiusMeters` |
| aluno/dependente não é seu / não matriculado | 403 | (mesmas mensagens do QR) |
| mais de um aluno seu na turma sem `studentId` | 400 | (igual ao QR) |
| limite de uso | 429 | 10/min por usuário (e teto por IP, como o QR) |

Distância pela fórmula de haversine já existente (`shared/geo/coordinates.ts`); regra estrita `distância <= raio`.

**Privacidade (LGPD — localização é dado pessoal):** o servidor NÃO guarda nem loga latitude/longitude/precisão em lugar nenhum
(nem banco, nem log de requisição, nem auditoria). Só a distância arredondada entra na auditoria. Resposta de erro não repete
as coordenadas recebidas.

Auditoria: nova ação `ATTENDANCE_GEO_CHECKIN` (`meta`: studentId, classId, distanceMeters, radiusMeters, hadAbsence) — sem coordenadas.
Pós-processamento IGUAL ao do QR (aviso "Presença registrada" idempotente, `ranking.queueSync`): extrair um método comum, sem duplicar.

Leitura da chamada: cada linha de presença devolvida pelas rotas de chamada/listagem do painel ganha
`checkinSource: 'QR' | 'GEO' | null`.

## 4. Painel
- Formulário/edição da turma: interruptor **"Permitir que o aluno registre a própria presença por localização (GPS)"**
  (padrão desligado), campo "Raio permitido (metros)" (50..500, padrão 150; só aparece ligado), dica "Usa o local da turma;
  se ela não tiver, usa o da unidade. Defina o local antes." e o erro `GEO_CHECKIN_NO_LOCATION` mostrado no campo. Mostra de onde
  vem o local (`geoCheckinLocation`) quando ligado, e um aviso se vier nulo.
- Chamada (lista de presença da aula e chamada rápida onde couber): selo discreto "Check-in por GPS" / "Check-in por QR"
  ao lado de quem veio por aí (`checkinSource`). Marcar manualmente continua como hoje.
- Permissão: quem já edita turmas.

## 5. App (aluno/responsável)
- Página de check-in existente (`/checkin`, QR): nova seção **"Check-in por localização"** que lista `available`.
  Cada item: aula, horário, aluno (se houver dependentes) e botão **"Estou aqui"**.
- Ao tocar: `navigator.geolocation.getCurrentPosition(..., { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })`
  (só no toque), envia latitude/longitude/accuracy; trata permissão negada (explica como liberar), timeout, indisponível, e os
  erros do §3 com mensagens claras ("Você está a 320 m do local; chegue a até 150 m."). Sucesso: confirmação e item vira "Presença registrada".
- Home: cartão discreto "Check-in disponível — <turma>" que leva à seção, SÓ quando há opção em janela e ainda não registrada.
- Nada de localização contínua/em segundo plano; a posição é lida uma vez por toque e não é guardada no app.
- Texto curto de privacidade junto ao botão: "Sua localização é usada só para confirmar que você está na aula e não é guardada."

## 6. Segurança / limites (resumo)
- GPS é falsificável pelo aparelho: é auxílio, não prova. Mitigações: janela de horário, matrícula, raio, limite de taxa,
  idempotência, origem visível ao professor (selo), e o professor pode corrigir a chamada.
- Sem coordenadas persistidas. Sem token de turma por trás (a turma precisa estar com a opção LIGADA pelo grupo).
- Multi-tenant: tudo filtrado pelo `organizationId` do token; id de outro grupo = 404.
