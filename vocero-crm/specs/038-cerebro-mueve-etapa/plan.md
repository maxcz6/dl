# 038 — Plan

Spec: [spec.md](spec.md).

## Constitution Check (antes de la Fase 0)

Sin violaciones: contrato aditivo, sin migración, todo por la puerta única de
etapas.

## Fase 0 — Lo que se investigó

| Pregunta | Respuesta |
|---|---|
| ¿Cómo movía el agente borrado? | `git show 67eb7a0 -- src/server/ai/pipeline.ts src/server/ai/actions.ts`: acción `move_stage {stage}` con el nombre; `resolveStage` exacto y luego sin mayúsculas contra todas las etapas; `moveLeadThroughHistory` con `source: "bot"` y `lastActivityAt`. Sin motivo de pérdida: una etapa perdida la rechazaba la puerta |
| ¿La ficha mueve la etapa (034 D1)? | No. `upsertFicha` (`src/server/bot/ficha.ts`) solo guarda |
| ¿Quién más mueve hoy? | El dueño (`PATCH /api/pipeline/leads/[id]`, `source: "dueno"`), la agenda al reservar (`advanceLeadStage`, solo hacia adelante a la siguiente abierta), el reinicio de pruebas y la reubicación al borrar una etapa |
| ¿Qué ve el cerebro del lead? | `lead: { id, stageName }` en `/api/bot/context`; Nea lo pinta en el prompt (`app/prompt.py`) |
| ¿Cada cuánto lee Nea el contexto y el perfil? | El contexto, cada turno; el perfil, cada 5 minutos |
| ¿La conversión a Meta excluye el Laboratorio? | Sí: `reportStageChange` filtra `is_test = false` |
| ¿La pantalla Agente pinta el catálogo? | Sí: `HERRAMIENTAS.filter(...)` en `agent-client.tsx` |

## Fase 1 — Diseño

### CRM

1. `src/lib/agent-roles.ts`: herramienta `etapa` («Mover de etapa») justo
   después de `ficha`, que es con la que va de la mano. El orden del catálogo
   es el de `tools` en el perfil; el guion `e2e-roles.mjs` se actualiza.
2. `src/server/bot/stage.ts` (puro + BD):
   - `etapasSiguientes(stages, currentStageId)`: abiertas con posición mayor
     que la actual, en orden. Pura, probada en unit.
   - `resolverEtapa(pedida, stages)`: por id, luego nombre exacto recortado,
     luego sin mayúsculas. Pura.
   - `moverEtapaPorElCerebro({organizationId, conversationId, stage})`: lee
     conversación, perfil (herramienta), lead y etapas; decide y llama a
     `moveLeadToStage`. Devuelve un resultado tipado que la ruta traduce.
3. `src/app/api/bot/stage/route.ts`: `POST`, `requireBotKey`, `parseBody`,
   traduce el resultado a 200/404/409/422 y publica `conversation.updated`.
4. `src/app/api/bot/context/route.ts`: `lead.nextStages`.
5. `docs/openapi.json`: ruta, `Contexto.lead.nextStages`, enum de `tools`,
   cambios de la 2.0 en `info.description`.
6. AGENTS.md (tabla de `/api/bot/*`) y `docs/migrar-a-2.0.md` si lista rutas.

### Nea (rama propia)

1. `TOOL_SCHEMAS` + `move_stage {etapa}`; `CLAVE_DE_HERRAMIENTA["move_stage"] = "etapa"`.
2. Solo se ofrece con `lead.nextStages` no vacía en el contexto del turno.
3. `CrmClient.move_stage(conversation_id, etapa)` → `POST /api/bot/stage`;
   409/422 vuelven al modelo como `{ok: false, error, detalle}`.
4. Prompt: «Puedes mover al lead a: A, B».

## Pruebas

- Unit: `tests/unit/bot-etapa.test.ts` (puras), `roles-como-datos` y
  `openapi` al día.
- E2E: `tests/e2e/us-etapa.md` + `scripts/e2e-etapa.mjs` con el cerebro falso
  (modo que mueve la etapa cuando el texto dice «califica»).

## Constitution Check (después del diseño)

Sin cambios.
