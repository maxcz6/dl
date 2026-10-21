# 033 — Plan

Spec: [spec.md](spec.md).

## Constitution Check (antes de la Fase 0)

Sin violaciones. El punto delicado es el sandbox: el envío real sigue
imposible para `is_test` (el guard de `sendText` no se toca); lo que cambia es
que `/api/bot/messages` guarda la respuesta en vez de rechazarla.

## Fase 0 — Lo que se investigó

| Pregunta | Respuesta |
|---|---|
| ¿Dónde se descarta hoy un despacho de prueba? | Dos guardas: `despacharAlCerebro` (ingesta) y `procesar` del worker, las dos por `conv.isTest` |
| ¿Cómo guarda el agente incluido una respuesta de prueba? | `persistTestOutbound` en `src/server/ai/pipeline.ts`: inserta el saliente (`sent`, `ai`) sin tocar Meta |
| ¿«Escribiendo…» con una de prueba? | `/api/bot/typing` ya responde `{ok:false, reason:"sandbox"}` sin tocar Meta |
| ¿Citas de prueba? | `agenda/service.ts` toma `isTest` de la conversación y no llama al conector |
| ¿Contexto de una de prueba? | Por `conversationId` sí resuelve; por identidad no (a propósito) |
| ¿Cómo encola el despacho? | `encolarDespacho` fija `notBefore` = ahora + `AGENT_COALESCE_MS` |

## Fase 1 — Diseño

### CRM

1. `src/server/lab/sandbox.ts`: `guardarRespuestaDePrueba` (lo que hoy es
   `persistTestOutbound`, que pasa a usarla).
2. `POST /api/bot/messages`: conversación `is_test` → `ai_paused` si toca, o
   guardar con `guardarRespuestaDePrueba` y 200 `{messageId, status:"sent"}`.
3. `encolarDespacho` acepta `inmediato: true` (sin ventana). El worker no
   descarta `is_test`. `construirEvento` añade `conversation.test: true` solo
   a las de prueba (`armarEvento` con `test?`).
4. Runner: `porDespacho = leerConfigDespacho().active`. Por línea: entrante +
   `encolarDespacho({inmediato:true})` + `programarTanda` + espera (90 s) a
   saliente posterior, traspaso o despacho `caducado_a_humano`. Al terminar el
   caso, `avisarOlvido`. Motivos de D7.
5. `POST /api/lab/runs`: 409 `sin_agente` si no hay despacho ni agente
   incluido configurado; el juez sigue exigiendo IA (`ai_not_configured`).
6. Personas `hostil` y `sin_rumbo`.
7. `scripts/e2e-laboratorio.mjs`: cerebro HTTP de prueba que contesta por
   `/api/bot/messages` (y uno caído).
8. Contrato 021 enmendado.

### Nea

1. `InboundMessage.prueba` desde `conversation.test`.
2. Gate 1 de `run_turn`: una prueba no pasa por `ALLOWED_WA_IDS`.
3. Sin seguimiento para una prueba.
4. Pruebas en `tests/test_despacho_raiz.py`.

## Constitution Check (después del diseño)

Sin cambios.
