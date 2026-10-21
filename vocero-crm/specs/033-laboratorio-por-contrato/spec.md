# 033 — Laboratorio por contrato

**Feature Branch**: `feat/033-laboratorio-por-contrato` (en `vocero-crm` y en `nea-agent`)

**Created**: 2026-10-20

**Status**: Especificada antes de escribir código.

**Input**: segunda pieza de la 2.0.0 (`PLAN-2.0.md`): kevinrivm/vocero-crm#91.
Kevin autorizó en el chat del 2026-10-20 mergear la 031 y seguir. Es la
condición previa para retirar el agente incluido (#106).

**Carril**: ciclo completo (Principio VI). Cambia dos contratos publicados, los
dos de forma aditiva: el despacho gana `conversation.test`, y
`POST /api/bot/messages` deja de responder 409 `sandbox_violation` a una
conversación de prueba. Plan en [plan.md](plan.md), tareas en
[tasks.md](tasks.md); el contrato se enmienda en
[`021/contracts/despacho.md`](../021-despacho-estandar/contracts/despacho.md).

## Problema

El Laboratorio solo sabe probar al agente incluido: `src/server/lab/runner.ts`
llama a `runAgentTurn` dentro del mismo proceso. Quien usa Nea —desde la 2.0,
todo el que quiera agente— no tiene Laboratorio, y lo que se evalúa no es lo
que contesta en producción. Sin esto no se puede retirar el agente incluido:
el CRM se quedaría sin forma de probar a quien contesta.

## Historias

**H1 — El Laboratorio prueba al cerebro que contesta.** Con el despacho
activo, cada línea del guion le llega al cerebro como un mensaje de cliente,
por el mismo camino que en producción; el cerebro contesta por
`/api/bot/messages` y el juez evalúa lo que volvió.

**H2 — Nada sale del CRM.** Ningún mensaje de una corrida llega a Meta, a
Zernio ni al wa-mock; ninguna cita de prueba llega a un conector.

**H3 — Si no hay quién conteste, se dice.** Sin cerebro conectado, o con el
cerebro caído, la corrida termina con un motivo legible, no colgada.

**H4 — Dos personas más**: hostil y sin rumbo.

## Decisiones

**D1 — El runner elige el camino según quién contesta en producción.** Con el
despacho activo (`BRAIN_DISPATCH_URL` y `BOT_API_KEY`), la corrida va por el
despacho. Sin él, como hoy, contra el agente incluido (ese camino sale con la
#106).

**D2 — Por despacho, una línea a la vez y sin ventana de agrupado.** El runner
guarda la línea como entrante de la conversación de prueba y encola su
despacho con `notBefore` = ahora. Espera, con un tope de **90 s por turno**,
lo primero que pase: una respuesta del agente posterior a esa línea, un
traspaso, o que el despacho caiga a humano. El tope de 10 minutos por corrida
se queda.

**D3 — Solo el Laboratorio despacha conversaciones de prueba.** La ingesta
sigue sin encolar una conversación `is_test` (no hay manera de que un mensaje
real caiga en una). El worker del despacho deja de descartar las `is_test`:
la única forma de que exista un despacho de una es que lo haya encolado el
runner.

**D4 — El evento lleva `conversation.test: true`, solo en las de prueba.**
Como las llaves de la 031: aparece cuando aplica, y el cuerpo gemelo no
cambia. Le dice al cerebro que es una prueba (Nea: pasa aunque la identidad no
esté en `ALLOWED_WA_IDS` y no programa seguimiento).

**D5 — `POST /api/bot/messages` en una conversación de prueba guarda la
respuesta y no envía.** Hoy responde 409 `sandbox_violation`. Ahora: si la IA
está pausada o traspasada, 409 `ai_paused` como siempre; si no, la respuesta
se guarda en el hilo (origen `ai`, estado `sent`) y responde 200. El guard de
`sendText` se queda: el envío real sigue siendo imposible para una
conversación de prueba. Ficha, etapa, traspaso, contexto y agenda ya operan
sobre la conversación de prueba; una cita de prueba ya no toca conectores
(015).

**D6 — Olvido después de cada caso.** Al terminar un caso, el runner le manda
al cerebro `conversation.deleted` de esa conversación de prueba (026): la
memoria del cerebro no crece con cada corrida, y la siguiente arranca de cero
también por la regla del `conversation.id` nuevo.

**D7 — Motivos legibles.** Si el cerebro no contesta un turno a tiempo o el
despacho cae a humano, el caso queda `agent_failed` (estado nuevo, sin
migración: la columna es texto), fuera del score, y el motivo va al `error` de
la corrida; si ningún caso obtuvo respuesta, la corrida termina `failed` con
«el agente no contestó: …». *Decidido al implementar:* el 409 `sin_agente` al
iniciar queda para la #106: hoy, sin despacho, el agente incluido siempre
contesta las pruebas si hay IA, y eso ya lo valida `ai_not_configured`.

**D7b — Un silencio con el despacho entregado es una respuesta** (decidido
tras la prueba en vivo del 2026-10-20). Nea calla a propósito ante el relleno
después de despedirse (candado de cierre): la primera corrida en `vocero20`
marcó «Sin rumbo» como `agent_failed` por eso. Entregado el despacho, el runner
espera la respuesta hasta 45 s; si no llega, el silencio queda en la
transcripción y el juez lo evalúa. Falla es solo un despacho que no se
entregó.

**D8 — Personas nuevas: `hostil` y `sin_rumbo`.** La de nota de voz queda
fuera: necesita un adjunto servible por `/api/bot/media` sin Meta, y eso llega
con el almacenamiento (#93). Las personas como datos del rol son de la #90.

**D9 — El juez sigue en el CRM** y sigue usando la llave de Ajustes → IA
(decisión de #106: la llave vive en el CRM).

**D10 — Fuera**: roles y personas por rol (#90), el OpenAPI (#92), el retiro
del agente incluido (#106).

## Criterios de aceptación

- **AC1** — Con el despacho activo, una corrida completa contra un cerebro de
  prueba (`e2e-laboratorio.mjs`) termina `done`, con transcripciones que
  traen lo que el cerebro contestó por `/api/bot/messages`.
- **AC2** — En esa corrida, el wa-mock no registra ningún envío y ningún
  despacho sale de una conversación real.
- **AC3** — El evento de una conversación de prueba trae `conversation.test:
  true`; el de una real no trae la llave. El cuerpo gemelo no cambia.
- **AC4** — `POST /api/bot/messages` en una conversación de prueba: 200 y el
  mensaje en el hilo; con traspaso, 409 `ai_paused`. En una real, igual que
  hoy.
- **AC5** — Con el cerebro caído, la corrida termina `failed` con un motivo
  legible en menos de 2 minutos por caso, y sin colgarse.
- **AC6** — Después de cada caso le llega al cerebro `conversation.deleted`.
- **AC7** — Nea: una conversación de prueba pasa la lista de permitidos y no
  programa seguimiento; una real fuera de la lista sigue sin respuesta.
- **AC8** — Sin despacho, el Laboratorio sigue corriendo contra el agente
  incluido (`e2e-selftest.mjs` en verde).
- **AC9** — Gates verdes en los dos repos.
- **AC10** — En vivo: una corrida en `vocero20` contra Nea, en verde, con el
  número sin tocar.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | Ninguna llave nueva. El flag de prueba viaja firmado con `BOT_API_KEY` |
| III Multi-tenancy | Todo por la organización de la instancia, como hoy |
| IV Idempotencia | El despacho de prueba usa la misma cola, lease y dedup del despacho real |
| Sandbox del Laboratorio | `sendText` sigue lanzando con `is_test`; `/api/bot/messages` guarda sin enviar; las citas de prueba no tocan conectores |
| VI Spec antes de código | Este documento |
| IX Hecho = probado en vivo | AC10: una corrida real contra Nea en Coolify |
