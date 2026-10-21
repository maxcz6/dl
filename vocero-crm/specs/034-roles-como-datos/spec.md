# 034 — Roles como datos

**Feature Branch**: `feat/034-roles-como-datos` (en `vocero-crm` y en `nea-agent`)

**Created**: 2026-10-20

**Status**: Especificada antes de escribir código.

**Input**: tercera pieza de la 2.0.0 (`PLAN-2.0.md`): kevinrivm/vocero-crm#90.
Kevin autorizó en el chat del 2026-10-20 mergear la 033 y seguir con la #90.

**Carril**: ciclo completo (Principio VI). Toca el modelo de datos (migración
aditiva en `agent_profile`) y un contrato publicado (`GET /api/bot/profile`
gana `role` y `tools`, de forma aditiva). Plan en [plan.md](plan.md), tareas
en [tasks.md](tasks.md).

## Problema

Un rol —qué hace el agente— hoy es código: las herramientas que Nea le enseña
al modelo están cableadas, y las personas del Laboratorio también. Encender o
apagar una herramienta exige tocar código y redesplegar. Kevin lo planteó así
(chat del 2026-10-19): arreglar o cambiar al agente no debe obligar a
redesplegar nada.

## Historias

**H1 — Quien administra enciende y apaga herramientas.** En la pantalla
Agente, una lista: llenar la ficha, agendar, reprogramar, dar una salida digna
y pasar a una persona. Apagar «agendar» hace que el agente deje de ofrecer
citas, sin redesplegar el CRM ni el cerebro.

**H2 — Un rol se carga como un bloque.** «Cargar el preset Calificador» deja
las instrucciones, las herramientas y las personas del Laboratorio de ese rol.

## Decisiones

**D1 — El catálogo de herramientas, con nombres estables** (`src/lib/agent-roles.ts`):

| Clave | Qué hace | Herramientas de Nea |
|---|---|---|
| `ficha` | Llena la ficha del lead; el CRM mueve la etapa cuando la ficha lo pide | `update_ficha` |
| `agendar` | Ofrece horarios y reserva | `propose_slots`, `book_session` (y en cloud, `list_bookings`, `cancel_session`) |
| `reprogramar` | Mueve una cita ya reservada | `reschedule_session` |
| `salida` | Despide con dignidad a quien no califica, con recursos | `route_out` |
| `escalar` | Pasa la conversación a una persona | `handoff` |

«Mover etapa», que el issue nombra aparte, no es una herramienta de Nea: el CRM
mueve la etapa cuando la ficha lo pide. Va dentro de `ficha`.

**D2 — `escalar` no se apaga.** Es la red de seguridad: quien pide una persona
y la hostilidad sostenida la usan. Viaja siempre y la pantalla la enseña fija.

**D3 — `agendar` y `reprogramar` solo aparecen con `AGENDA=on`.** Sin la
bandera, la pantalla no los ofrece; Nea ya los quita sola cuando el CRM no
agenda.

**D4 — Modelo de datos**: `agent_profile.role` (texto, `calificador` por
defecto) y `agent_profile.tools` (jsonb, lista de claves; `null` = todas).
Migración aditiva `0021_roles_como_datos`. Una instalación que actualiza queda
con el Calificador y todas sus herramientas: nada cambia hasta que alguien
apague una.

**D5 — Contrato**: `GET /api/bot/profile` gana `profile.role` y
`profile.tools` (las claves encendidas, `escalar` siempre incluida). Un
cerebro que no las conozca las ignora; si no vienen, el cerebro enciende todo,
como hoy.

**D6 — Nea**: lee `role` y `tools` y le enseña al modelo solo las herramientas
encendidas. Sin `agendar`, además, el prompt dice que por aquí no se agenda
(el mismo camino que cuando el CRM no tiene agenda). El perfil se relee cada
5 minutos (`PROFILE_TTL_SECONDS`): ese es el «en cuanto relee el perfil».

**D7 — El preset «Calificador»** (el único rol de 2.0): instrucciones base de
calificación, todas las herramientas y las 8 personas del Laboratorio. Cargarlo
**reemplaza** las instrucciones y las reglas de escalado del perfil: la
pantalla pide confirmación.

**D8 — Personas por rol**: dejan de ser una lista suelta del Laboratorio y
pasan a ser datos del rol (`ROLES.calificador.personas`). El runner corre las
del rol del perfil.

**D9 — El agente incluido no lee `tools`.** Sale con la #106; la pantalla
enseña las herramientas solo con el despacho activo, y sin él explica que las
respeta el agente conectado.

## Criterios de aceptación

- **AC1** — `PUT /api/agent/profile` con `tools` guarda solo claves del
  catálogo y siempre deja `escalar`; una clave desconocida es 422.
- **AC2** — `GET /api/bot/profile` trae `role` y `tools`; sin configurar, todas.
- **AC3** — Cargar el preset deja rol, instrucciones, reglas de escalado,
  herramientas y personas del Calificador.
- **AC4** — Nea: con `tools` sin `agendar`, al modelo no se le enseñan
  `propose_slots` ni `book_session` y el prompt dice que no agenda; sin `tools`
  en el perfil, todas como hoy.
- **AC5** — En vivo: apagar «agendar» en `vocero20` hace que una corrida del
  Laboratorio o una conversación ya no ofrezca horarios, sin redesplegar
  (esperando el TTL del perfil).
- **AC6** — Gates verdes en los dos repos; migración probada sobre base vacía
  y sobre una base en `0020` con un perfil.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| III Multi-tenancy | Las columnas son del perfil de la organización; todo por `scoped()` |
| IV Idempotencia | Migración aditiva y re-ejecutable; `null` = todas mantiene el comportamiento |
| VI Spec antes de código | Este documento |
| IX Hecho = probado en vivo | AC5 |
