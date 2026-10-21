# Implementation Plan: Motor de agendamiento universal (bandera + conectores)

**Branch**: `015-motor-agenda-universal` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-motor-agenda-universal/spec.md`

**Estado**: planeación completa (Fase 0 + Fase 1). Enmienda constitucional
[**ratificada y aplicada**](./enmienda-constitucional.md) (1.4.0, 2026-08-26).
[`tasks.md`](./tasks.md) **generado** (2026-08-26, 58 tareas por historia).
Siguiente paso cuando el dueño lo decida: `/speckit-implement`.

## Summary

Se agrega al core el motor de agenda detrás de la bandera `AGENDA` (apagada por
defecto, criterios ADR-001): configuración por negocio, disponibilidad en UTC
calculada localmente, y ciclo de vida de citas con las dos garantías duras del
004 —**solo se reserva lo que se ofreció** (tabla `offered_slot` en el core,
comparación por epoch exacto) y **nunca se confirma una cita que no se creó**
(re-validación + índice UNIQUE parcial en base; `23505` → `409 slot_taken` con
alternativas frescas). Sobre el motor, la **capa de conectores**: un contrato
público de 4 operaciones (medido del uso real del fork en producción) con tres
conectores v1 — `enlace-fijo` (default, cero dependencias), `zoom` (S2S,
probado en el fork) y `google` (Calendar + Meet vía refresh token de app propia
del negocio). Los efectos hacia el proveedor son best-effort y posteriores a la
verdad del CRM: un tercero caído jamás cuesta la conversión (link pendiente +
reintento). La rama vieja `004-motor-agenda` no se rebasea: es cantera
(research D10).

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: **ninguna nueva** (FR-020). Next.js 15 (App Router),
Drizzle ORM, Zod, React 19 ya presentes. Fechas/zonas con `Intl` de la
plataforma (research D1). Conectores por HTTP con `fetch`, mismo patrón que
`src/lib/meta/`.

**Storage**: PostgreSQL + Drizzle. Cinco tablas nuevas (`calendar_settings`,
`booking`, `offered_slot`, `zoom_credentials`, `google_credentials`) en la
migración `drizzle/0009_motor_agenda.sql`, aditiva, re-ejecutable y aplicada
SIEMPRE al arranque (bandera apagada = tablas inertes).

**Testing**: Vitest para helpers puros y reglas del motor (incluida la carrera
por unique-violation); `pnpm test:e2e` (`scripts/e2e-selftest.mjs`) con sección
de agenda nueva conducida contra la app viva + mocks de conectores; CI con
matriz de dos configuraciones (FR-021).

**Target Platform**: el mismo monolito self-hosted; sin procesos, colas ni
servicios nuevos.

**Project Type**: web-service + UI en el mismo Next.js.

**Performance Goals**: disponibilidad de 7 días = una query + aritmética en
memoria, < 50 ms típico, sin caché; los efectos de conector corren fuera del
camino de la respuesta cuando es posible y nunca la bloquean más allá de su
timeout corto.

**Constraints**: instantes en UTC; horario semanal en hora de pared; DST
correcto; `organization_id` vía `scoped()` en toda query; `/api/bot/*` tras
`BOT_API_KEY` (tiempo constante); `is_test` sin efectos externos; bandera
apagada ⇒ 404 en toda la superficie y prompt del agente intacto.

**Scale/Scope**: un negocio, una agenda, un conector activo. Ventana default 7
días, citas de 30 min ⇒ decenas de slots por consulta.

## Constitution Check

*GATE: evaluado antes de la Fase 0 y re-evaluado tras el diseño de Fase 1.*

| Principio | Cómo lo cumple esta feature |
|---|---|
| **I. Seguridad de datos** | Credenciales de conector cifradas AES-256-GCM con `lib/crypto` (mismo mecanismo, no uno segundo), tablas explícitas por proveedor, hacia afuera solo `last4` + estado; jamás a logs. El enlace fijo no se cifra: es una URL que el negocio reparte. |
| **II. Soberanía (endurecido, 1.4.0)** | ✅ CUMPLE bajo la constitución 1.4.0 ([enmienda ratificada y aplicada](./enmienda-constitucional.md) el 2026-08-26): `zoom` y `google` entran como **conectores opcionales** y el diseño satisface las cinco condiciones — (1) apagados por defecto tras `AGENDA`; (2) adaptadores aislados con contrato público; (3) camino sin dependencia (`enlace-fijo`) y degradación definida (link pendiente: la cita nunca depende del tercero); (4) credenciales del propio negocio cifradas; (5) matriz de CI + mocks con camino infeliz. Historia: contra la 1.3.0 esto era una violación registrada — queda documentada en Complexity Tracking para trazabilidad. |
| **III. Multi-tenancy** | `organization_id NOT NULL` org-first en las cinco tablas; acceso por `scoped()`; credenciales únicas por organización. |
| **IV. Idempotencia** | Cancelar dos veces no falla; `deleteMeeting` trata 404 como éxito; el índice UNIQUE parcial convierte la confirmación repetida/concurrente en `409` en vez de duplicado; migración `IF NOT EXISTS` re-ejecutable. |
| **V. Calidad verificable** | Gate técnico + unit de la carrera y del contrato de conectores + arnés E2E extendido; códigos y sobre verificados exactos (research D9). |
| **VI. Specs antes de código** | Carril ciclo completo declarado (toca modelo de datos y `/api/bot/*`); este plan y su spec preceden a todo código; `tasks.md` vendrá de `/speckit-tasks`. |
| **VII. Trazabilidad** | La reversión del README se argumenta por escrito en el spec; la decisión de conectores queda en ADR-002; el único punto sin confirmar (respuesta síncrona del link de Meet) está marcado NEEDS VERIFICATION en research D6 y contracts. |
| **VIII. Foco vertical** | Agendar es la conversión natural de una conversación de WhatsApp; el motor vive pegado a contacto/conversación/lead y avanza el pipeline por la puerta única de etapas. No es un producto de calendario: sin free-busy, sin multi-calendario, sin recordatorios en v1. |
| **IX. Verificación en vivo** | Quickstart define el self-test completo (bandera, garantías, carrera, link pendiente, sandbox) contra la app viva con mocks; nada se declara Hecho sin ese loop en verde. |

**Guardrail del Laboratorio**: las conversaciones `is_test` agendan citas
marcadas de prueba que JAMÁS invocan un conector (aserción antes de la
bifurcación, simétrica en crear/reprogramar/cancelar — FR-017, corrigiendo la
asimetría accidental del fork). El sender de WhatsApp sigue lanzando en
sandbox — no se toca.

**Resultado del gate**: PASA sin violaciones vigentes — la única (II, contra la
1.3.0) quedó resuelta por la enmienda ratificada y aplicada (1.4.0,
2026-08-26). Re-evaluado tras Fase 1: el diseño no agregó violaciones nuevas.

## Project Structure

### Documentation (this feature)

```text
specs/015-motor-agenda-universal/
├── spec.md                     # Qué y por qué (incluye la reversión del README)
├── plan.md                     # Este archivo
├── research.md                 # Fase 0: D1..D10 con evidencia
├── data-model.md               # Fase 1: cinco tablas, índice único parcial, transiciones
├── quickstart.md               # Fase 1: el self-test de punta a punta
├── enmienda-constitucional.md  # Propuesta 1.3.0 → 1.4.0 (GATE de implementación)
├── contracts/
│   ├── agenda.md               # API operador + bot (201/200/409 exactos, sobre anidado)
│   └── conector.md             # Contrato de conector + catálogo v1 + guía para forks
├── checklists/
│   └── requirements.md         # Calidad del spec
└── tasks.md                    # Fase 2 (/speckit-tasks) — 58 tareas en 9 fases, por historia
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── env.ts                            # EDITA · AGENDA + bases de mock de conectores (en el esquema zod, no process.env directo)
│   ├── time/
│   │   └── slots.ts                      # NUEVO · helpers puros Intl (cantera 004, con sus tests de DST)
│   └── db/
│       ├── schema.ts                     # EDITA · cinco tablas nuevas
│       └── ids.ts                        # EDITA · prefijos cal_/bk_/ofs_/zcred_/gcred_
├── server/
│   ├── agenda/
│   │   ├── flag.ts                       # NUEVO · agendaEnabled() + respuesta 404 (molde de channels/enabled.ts)
│   │   ├── settings.ts                   # NUEVO · get/upsert configuración + defaults
│   │   ├── availability.ts               # NUEVO · computeAvailability / findSlot (cantera 004)
│   │   ├── spread.ts                     # NUEVO · reparto por día (cantera fork; incidente 2026-08-07)
│   │   ├── offers.ts                     # NUEVO · offered_slot: replace/get/clear en transacción
│   │   ├── service.ts                    # NUEVO · ciclo de vida + garantías (23505→slot_taken) + efectos de conector best-effort
│   │   ├── queries.ts                    # NUEVO · listado para la UI
│   │   └── connectors/
│   │       ├── types.ts                  # NUEVO · contrato + capacidades (contracts/conector.md)
│   │       ├── index.ts                  # NUEVO · catálogo {enlace-fijo, zoom, google}
│   │       ├── enlace-fijo.ts            # NUEVO · default sin dependencias
│   │       ├── zoom.ts                   # NUEVO · S2S OAuth + caché de token (cantera fork)
│   │       ├── zoom-credentials.ts       # NUEVO · cifrado/estado (molde whatsapp/credentials.ts)
│   │       ├── google.ts                 # NUEVO · Calendar + Meet, REST directo
│   │       └── google-credentials.ts     # NUEVO
│   ├── ai/
│   │   ├── actions.ts                    # EDITA · offer_slots / book_slot en la unión, solo con bandera
│   │   ├── prompts.ts                    # EDITA · sección de agenda condicional (apagada = 0 tokens)
│   │   └── pipeline.ts                   # EDITA · ejecución de las dos acciones con degradación
│   └── dev/
│       ├── zoom-mock-state.ts            # NUEVO · estado inspeccionable (cantera fork)
│       └── google-mock-state.ts          # NUEVO
├── app/
│   ├── api/
│   │   ├── calendar/
│   │   │   ├── settings/route.ts         # NUEVO · GET/PUT (404 sin bandera)
│   │   │   └── availability/route.ts     # NUEVO · GET
│   │   ├── bookings/
│   │   │   ├── route.ts                  # NUEVO · GET / POST (201)
│   │   │   └── [id]/route.ts             # NUEVO · PATCH (reschedule/cancel/status/retry_link)
│   │   ├── bot/
│   │   │   ├── availability/route.ts     # NUEVO · GET (registra oferta; perDay/days)
│   │   │   └── bookings/route.ts         # NUEVO · POST 201 / PATCH 200 / 409 con slots
│   │   ├── settings/
│   │   │   ├── zoom/route.ts (+ test/)   # NUEVO · GET/PUT/DELETE + probar sin guardar
│   │   │   └── google/route.ts (+ test/) # NUEVO
│   │   └── dev/
│   │       ├── zoom-mock/[...path]/route.ts    # NUEVO · tras mockGuard(); _state/_reset; secret -invalid ⇒ fallo
│   │       └── google-mock/[...path]/route.ts  # NUEVO
│   └── (app)/
│       ├── layout.tsx                    # EDITA · calcula bandera (server) → AppShell → AppNav
│       ├── bookings/page.tsx             # NUEVO · "Citas" (404 sin bandera)
│       └── settings/
│           ├── layout.tsx                # EDITA · pasa bandera a SettingsNav
│           └── calendar/page.tsx         # NUEVO · Ajustes → "Agenda" (horario + conector + credenciales)
├── components/
│   ├── app-nav.tsx                       # EDITA · entrada "Citas" condicional por prop (patrón inbox/page.tsx)
│   ├── settings/settings-nav.tsx         # EDITA · pestaña "Agenda" condicional por prop
│   ├── settings/agenda-client.tsx        # NUEVO
│   └── bookings/bookings-client.tsx      # NUEVO · lista + acciones + "Reintentar enlace"
drizzle/0009_motor_agenda.sql             # NUEVO · aditiva, re-ejecutable, incluye el UNIQUE parcial
tests/unit/
├── slots.test.ts                         # NUEVO · DST y bordes (cantera 004)
├── availability.test.ts                  # NUEVO
├── offers.test.ts                        # NUEVO
├── booking-race.test.ts                  # NUEVO · 23505 → slot_taken
├── agenda-flag.test.ts                   # NUEVO · apagada/encendida (molde channels.test.ts)
└── connectors.test.ts                    # NUEVO · contrato compartido de los tres conectores
tests/e2e/us-agenda.md                    # NUEVO · guion de la historia (cantera 004)
scripts/e2e-selftest.mjs                  # EDITA · sección de agenda (códigos exactos)
.github/workflows/ci.yml                  # EDITA · matriz: default y todo-encendido (paga la deuda de ADR-001)
docs/
├── agenda-conectores.md                  # NUEVO · contrato público + guía "escribe tu conector" + scopes/gotchas
└── adr-002-conectores-de-agenda.md       # NUEVO · la decisión registrada (bandera AGENDA, 4 operaciones, sin free-busy)
README.md                                 # EDITA · reescribe "Fuera de alcance a propósito" + sección de agenda y conectores
.env.example                              # EDITA · AGENDA con guía inline
CLAUDE.md                                 # EDITA · mapa del código (fila de agenda/conectores) + regla de conectores
.specify/memory/constitution.md           # EDITADA · enmienda aplicada (1.4.0 + Sync Impact Report, 2026-08-26)
```

**Structure Decision**: se respeta la separación del repo — helpers puros en
`src/lib/`, dominio en `src/server/agenda/`, rutas delgadas que solo traducen
HTTP ↔ dominio (el motor no conoce HTTP: la carrera se testea sin levantar la
app). Los conectores viven DENTRO de `server/agenda/connectors/` con el molde
de aislamiento de `src/lib/meta/` (Constitución: "las dependencias de APIs
externas se acceden a través de adaptadores dedicados"). Rutas en inglés con
etiquetas en español, como el resto: `/bookings` (nav "Citas"),
`/settings/calendar` (pestaña "Agenda").

**Orden de entrega sugerido para `/speckit-tasks`** (por historias
independientes): US1 bandera (flag + 404 + navs condicionales + CI matriz) →
US2 settings + enlace-fijo → US3 motor + garantías + bot + agente → US4 página
Citas → US5 conector Zoom + mock → US6 conector Google + mock → docs/README/
ADR-002. La enmienda ya está ratificada y aplicada (1.4.0): US5 y US6 quedan
desbloqueadas desde el arranque.

## Complexity Tracking

| Violación | Por qué se necesita | Alternativa más simple rechazada porque |
|---|---|---|
| Principio II (contra la 1.3.0; RESUELTA por la enmienda 1.4.0 ratificada el 2026-08-26): servicios externos `zoom`/`google` fuera de la lista cerrada | Es el pedido del dueño y la ventaja competitiva declarada: la reunión debe entregarse donde el negocio ya vive (Zoom/Meet/Calendar), con contrato para que forks agreguen el resto | *Enlace fijo solamente* (el 004): no entrega reunión por cita ni evento en calendario — exactamente lo que el dueño pidió superar. *Forks por proveedor*: ADR-001 demostró empíricamente el costo (la propia rama 004 quedó irrescatable en 26 días). La enmienda habilitó la vía del conector opcional: apagado por defecto, aislado, degradable, credenciales propias, verificable |
| Cinco tablas nuevas (vs. tres del 004) | Las dos extra son credenciales por proveedor | *Un jsonb genérico de credenciales*: rechazado por el precedente escrito del repo ("unas credenciales tienen forma fija y conocida: así conservan tipado e índices") y porque cada conector de fork trae SU forma |
