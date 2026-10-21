# Implementation Plan: El despacho recuerda qué debe

**Branch**: `feat/025-despacho-recuerda` | **Spec**: [spec.md](spec.md) | **Contrato**: [021 · contracts/despacho.md](../021-despacho-estandar/contracts/despacho.md)

## Summary

Puerto de `2624262` (Vocero Cloud #117) sobre lo que el 021 ya trajo del #111.
La ingesta pasa el id del entrante hasta el encolado; el despacho lo anota; la
ráfaga suma lo anotado que quedó detrás de una respuesta del agente; el worker
descarta el despacho vacío y, tras entregar, vuelve a despachar lo que el
cerebro no recibió. El agente incluido, que en la raíz no pasa por el outbox,
lleva la misma cuenta en su coalesce.

## Technical Context

- **Stack**: el del repo. Sin dependencias nuevas.
- **Rendimiento**: el camino del webhook no gana consultas. Al despachar hay,
  como mucho, una consulta más (los atrasados), y solo cuando hay un debido
  fuera de la ráfaga. Tras entregar, una lectura de la fila.
- **Diferencia con cloud**: allá el agente incluido es un tipo de cerebro y su
  entrega es el turno; aquí `ai/trigger.ts` elige entre despacho y
  `scheduleAgentTurn`. Por eso `vistos` no viaja en `ResultadoEntrega`: se
  queda en `pipeline.ts`.

## Modelo de datos

`dispatch.message_ids jsonb NULL` — los ids (`msg_…`) de los entrantes que
encolaron o extendieron ese despacho. Nulo en las filas anteriores a `0017`,
que se comportan como antes. No lleva índice: solo se lee por la llave
primaria de la fila.

Migración `0017_dispatch_message_ids`: un `ALTER TABLE … ADD COLUMN`. Aditiva;
una instalación 1.5 la aplica al arrancar el contenedor.

## Diseño

**Despacho (cerebro externo)**

1. `ingestInboundMessage` → `maybeRunAgentTurn(conversationId, organizationId,
   message.id)` → `despacharAlCerebro(…, messageId)` →
   `encolarDespacho({ …, messageIds: [id] })`.
2. `encolarDespacho`: con una fila viva, `UPDATE … SET message_ids =
   coalesce(message_ids, '[]') || $ids` condicionado a que **siga viva**; si
   ya no lo está (el worker la terminó entre el `SELECT` y el `UPDATE`), abre
   fila propia. Si pierde la carrera del índice único contra otro mensaje
   simultáneo, reintenta una vez para anotarse en la fila que ganó.
3. `rafagaDe(org, conv, debidos)`: la ráfaga de siempre, más los debidos que
   no estén en ella y cuya hora sea posterior al último saliente con
   `ai_generated = false` (comparado en Postgres).
4. `construirEvento` pasa `fila.messageIds`; devuelve el evento aunque no
   traiga mensajes, y `null` solo si la conversación o el contacto ya no
   existen.
5. `procesar`: evento sin mensajes → `descartarDespacho(«sin mensajes por
   despachar»)`. Tras `marcarEntregado`: `mensajesAnotados(fila)` →
   `rafagaDe(…, anotados)` → `sinDespachar(entregados, actual)` → si hay,
   `encolarDespacho({ messageIds: pendientes })`.

**Agente incluido**

6. `scheduleAgentTurn(conversationId, messageId)`: la entrada de coalesce gana
   `debidos: Set<string>`.
7. `executeTurn`: toma los debidos, deja el conjunto vacío para lo que entre
   durante el turno y llama `runAgentTurn(id, { debidos })`. Al volver, quita
   de lo recién anotado lo que el turno leyó (`vistos`). Repite el turno si
   quedó algo, o si el turno no llegó a leer (falló o se calló antes): en ese
   caso devuelve a la cuenta lo que traía.
8. `runAgentTurn`: carga los debidos por id (con `scoped`), descarta los que
   una persona ya contestó (`debidosVigentes`) y ordena el historial con
   `ordenarParaElTurno`. Devuelve `{ vistos }` o `undefined` si no abrió el
   historial.

## Project Structure

```text
src/lib/db/schema.ts                     dispatch.messageIds
drizzle/0017_dispatch_message_ids.sql    migración (+ snapshot y journal)
src/server/inbox/ingest.ts               pasa message.id
src/server/ai/trigger.ts                 lo lleva al despacho o al coalesce
src/server/dispatch/encolar.ts           lo pasa al outbox
src/server/dispatch/outbox.ts            anotar, mensajesAnotados
src/server/brains/deliver.ts             rafagaDe con debidos, sinDespachar
src/server/dispatch/worker.ts            descartar el vacío, releer lo anotado
src/server/ai/orden-turno.ts             ordenarParaElTurno, debidosVigentes (puras)
src/server/ai/pipeline.ts                debidos en el coalesce; runAgentTurn devuelve vistos
src/server/dev/ai-mock.ts                demora y registro de peticiones
src/app/api/dev/ai-mock/**/route.ts      GET para configurarlo y leerlo
specs/021-despacho-estandar/contracts/despacho.md   dos notas nuevas
tests/unit/despacho-config.test.ts, orden-turno.test.ts, handoff-ack.test.ts
tests/e2e/us-despacho.md, scripts/e2e-despacho.mjs
AGENTS.md, CHANGELOG.md, specs/README.md
```

## Verificación

- Los cuatro gates.
- `scripts/e2e-despacho.mjs` en sus dos modos: con `BRAIN_DISPATCH_URL` (todas
  las secciones del 021 más «mientras piensa» y «persona en la ventana») y sin
  ella (agente incluido con un mensaje en vuelo).
- `pnpm test:e2e` sin la variable: el agente incluido no cambió.
- Migración sobre una base vacía y sobre una en `0016` con un despacho
  pendiente.
- En vivo: dos mensajes seguidos por WhatsApp, respondidos.
