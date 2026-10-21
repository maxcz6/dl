# 034 — Plan

Spec: [spec.md](spec.md).

## Constitution Check (antes de la Fase 0)

Sin violaciones: migración aditiva, contrato aditivo.

## Fase 0 — Lo que se investigó

| Pregunta | Respuesta |
|---|---|
| ¿Qué herramientas tiene Nea? | `update_ficha`, `propose_slots`, `book_session`, `reschedule_session`, `route_out`, `handoff`; en cloud con agenda v2, `list_bookings`, `cancel_session`, `coordination_consent` (`app/tools.py`) |
| ¿Cómo las elige hoy? | `tool_schemas(agenda_enabled, agenda_v2, coordination)` en `_tool_loop`; sin agenda quita `AGENDA_TOOLS` y el prompt lo dice |
| ¿Cada cuánto relee el perfil? | `PROFILE_TTL_SECONDS = 300` (`app/profile.py`) |
| ¿Qué guarda `agent_profile`? | `enabled`, `name`, `tone`, `instructions`, `escalation_rules`, `greeting` |
| ¿De dónde salen las personas? | `src/server/lab/personas.ts`, lista fija |

## Fase 1 — Diseño

### CRM

1. `src/lib/agent-roles.ts`: `HERRAMIENTAS` (D1–D3), `ROLES.calificador`
   (etiqueta, instrucciones, reglas de escalado, herramientas, personas) y
   `herramientasEfectivas(tools)`.
2. Migración `0021_roles_como_datos`: `role text not null default
   'calificador'`, `tools jsonb`.
3. `serializeBotProfile`: `role`, `tools`.
4. `/api/agent/profile`: GET devuelve `role`, `tools` (efectivas), el catálogo
   y si hay agenda; PUT acepta `tools` validadas.
5. `POST /api/agent/profile/preset` `{role}`.
6. Personas al rol: `src/server/lab/personas.ts` exporta las del catálogo; el
   runner toma las del rol del perfil.
7. Pantalla Agente: tarjeta «Herramientas» (con despacho) y el botón del
   preset con confirmación.

### Nea

1. `BusinessProfile.role`, `BusinessProfile.tools` (`frozenset | None`).
2. `tool_schemas(..., herramientas)`: filtra por clave del catálogo.
3. `run_turn`: `agenda` del turno = la del CRM y `agendar` encendida.

## Constitution Check (después del diseño)

Sin cambios.
