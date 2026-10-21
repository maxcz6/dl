# 036 — Retiro del agente incluido

**Feature Branch**: `feat/036-retiro-agente-incluido`

**Created**: 2026-10-20

**Status**: Especificada antes de escribir código.

**Input**: quinta pieza de la 2.0.0 (`PLAN-2.0.md`): kevinrivm/vocero-crm#106.
Kevin autorizó en el chat del 2026-10-20 mergear la 035 y seguir con la #106.
Decisiones de producto ya tomadas por Kevin para la 2.0: el cerebro piensa
por el CRM (`/api/bot/llm`, opción recomendada del issue) y el par usa una
sola base.

**Carril**: ciclo completo (Principio VI). Quita una capacidad (el CRM deja de
contestar solo), cambia el contrato (`/api/bot/llm`, `llm` en el perfil) y el
significado del interruptor del agente. Plan en [plan.md](plan.md), tareas en
[tasks.md](tasks.md).

## Problema

Mantener dos agentes es la duplicación que la 2.0 viene a quitar. El incluido
es el incompleto: una llamada por turno y solo texto. Lo que le falta (audio,
imagen y PDF, el candado «sin rumbo», seguimiento, hostilidad, formato de
WhatsApp, reprogramar) ya está en Nea, y probado. Y desde la 021, con el
despacho activo, el incluido ya ni contesta: es código muerto que confunde
(«Quién responde», `doble_respuesta`, un interruptor que no decide nada).

## Historias

**H1 — El CRM no trae agente.** Sin cerebro conectado, Vocero es un CRM de
bandeja manual: recibe, envía a mano, pipeline, agenda. La interfaz lo dice
sin tratarlo como error.

**H2 — La llave de IA se pone una vez, en el CRM.** Nea piensa por
`/api/bot/llm`; quien instala no copia la llave a Nea. Un 401 o 402 del
proveedor pausa la credencial en Ajustes → IA, como antes.

**H3 — El interruptor del agente decide.** Encendido = el CRM le despacha al
cerebro. Solo se enciende con un cerebro conectado y sano.

**H4 — La guía de inicio dice «conecta tu agente»**, no «enciende el agente».

**H5 — El Laboratorio prueba al cerebro conectado**; sin cerebro, lo dice.

## Decisiones

**D1 — Sale el turno dentro del proceso.** `src/server/ai/pipeline.ts`,
`actions.ts`, `trigger.ts`, `handoff.ts`, `orden-turno.ts`, el prompt del
agente en `prompts.ts` y `src/server/agenda/agent.ts`, con sus pruebas; el
ramo del agente en el ai-mock; `scripts/eval-silencios.ts`. De `prompts.ts`
se quedan `renderKb` (lo usan `/api/bot/profile` y el tamaño del
conocimiento) y el prompt del juez. La ingesta llama directo al despacho.

**D2 — `agent_profile.enabled` = «el CRM despacha».** El despacho se encola
solo con el despacho configurado **y** el interruptor encendido (hoy basta lo
primero). `PUT /api/agent/profile {enabled: true}` responde **409
`sin_cerebro`** si no hay despacho configurado o el `/health` del cerebro no
contesta; apagar siempre se puede. *Cambio de conducta para quien ya
despachaba con el interruptor apagado* (en la 021 no importaba): la migración
no puede saber el entorno, así que lo dicen la guía de migración, el CHANGELOG
y la tarjeta «Quién responde» («el cerebro está conectado y el agente
apagado»).

**D3 — La dirección del cerebro sigue en el entorno** (`BRAIN_DISPATCH_URL`,
`BRAIN_HEALTH_URL`, `BOT_API_KEY`), como desde la 021. El issue pedía «URL del
cerebro, llave y prueba de conexión» en la guía; se queda en el entorno porque
el cerebro es infraestructura que va al lado del CRM (el compose y Coolify ya
lo cablean) y la llave firma el despacho: no es algo que deba cambiar quien
administra desde el navegador. La guía muestra el estado y prueba la conexión
(el mismo `/health` de «Quién responde»).

**D4 — `POST /api/bot/llm/{ruta}`**, puerto de `/api/brains/llm` de la edición
cloud. Compatible con OpenAI: el SDK de un cerebro apunta su `base_url` aquí y
no cambia nada más. Autentica con `BOT_API_KEY` en `X-API-Key` o en
`Authorization: Bearer` (lo que manda el SDK). Reenvía el cuerpo **tal cual**
a `{baseUrl}/v1/{ruta}` con la llave de Ajustes → IA (o, de respaldo,
`OPENROUTER_*`); la respuesta del proveedor vuelve tal cual, con su código.
- Sin IA configurada o pausada: **402 `sin_credencial`**.
- 401/402 del proveedor pausan la credencial de la organización; un 2xx la
  reactiva (las mismas funciones del adaptador interno). El respaldo del
  entorno no tiene fila que pausar.
- Timeout o red: **504 `proveedor_sin_respuesta`**, sin pausar.
- **Sin lista de modelos permitidos** (cloud la tiene). Allá el cerebro puede
  ser de un tercero y gastar la cuenta de otro; aquí el cerebro lo pone quien
  instala y entra con la misma llave que ya escribe en la bandeja. El perfil
  le dice qué modelo eligió el negocio (D5).
- La llave nunca se loguea ni vuelve en una respuesta.

**D5 — El perfil gana `llm`** (aditivo): `{ "path": "/api/bot/llm", "model":
"<el de Ajustes → IA>" }`, o `null` sin IA configurada. Va al OpenAPI.

**D6 — Nea piensa por el CRM** cuando `LLM_API_KEY` está vacía: su cliente del
modelo apunta a `{CRM_BASE_URL}/api/bot/llm` con `CRM_BOT_API_KEY`, y usa el
modelo que dice el perfil (`LLM_MODEL` si el perfil no trae). Con
`LLM_API_KEY`, Nea sigue con su llave (cerebro propio con su proveedor). El
`/health` dice `llm: "crm" | "propia"`. Va en nea 2.0.0 (sin publicar).

**D7 — Guía de inicio.** El paso «IA» se queda (es con lo que piensa el
agente); se suma **«Conecta tu agente»**: listo cuando el despacho está
configurado y el `/health` contesta. La tarjeta final: «enciende tu agente»
solo cuando hay cerebro; sin él, «Vocero funciona como bandeja manual; para
que un agente conteste, conéctalo» con enlace a la guía.

**D8 — «Quién responde»** pierde el agente incluido: el DTO deja `embedded`,
se queda el cerebro externo y el despacho, y gana `enabled`. Avisos:
`doble_respuesta` se va; queda `sin_cerebro` (informativo), y uno nuevo,
`apagado`, cuando el cerebro está conectado y el interruptor no.

**D9 — Laboratorio.** Sin despacho activo, crear una corrida responde **409
`sin_cerebro`** y la pantalla lo explica. El juez sigue usando la llave de
Ajustes → IA. El sandbox de `/api/bot/*` (033) no cambia.

**D10 — Compose.** El servicio `nea` deja de llevar `LLM_API_KEY` (piensa por
el CRM); `.env.example` pierde `NEA_LLM_API_KEY`. El perfil `nea` se queda
hasta publicar nea 2.0.0 (035 D6).

**D11 — Ajustes → IA** dice para qué es la llave: «con esta llave piensa tu
agente (a través del CRM) y el juez del Laboratorio».

**D12 — Fuera:** el almacenamiento (#93); el starter 3.0.0; poner la URL del
cerebro en la interfaz (D3).

## Criterios de aceptación

- **AC1** — `pnpm test` y los E2E pasan sin `src/server/ai/pipeline.ts`; un
  `grep` no encuentra imports del turno dentro del proceso.
- **AC2** — Sin cerebro: la instancia arranca, recibe y envía a mano, la guía
  dice qué falta, encender el agente da 409 `sin_cerebro`, el Laboratorio
  también.
- **AC3** — `/api/bot/llm`: sin llave 401; con `Bearer` y con `X-API-Key`
  reenvía al proveedor (ai-mock) con la llave de Ajustes → IA y devuelve su
  respuesta; 401 del proveedor pausa la credencial; sin IA, 402
  `sin_credencial`; el token no aparece en la respuesta ni en logs.
- **AC4** — Con cerebro y el interruptor apagado no se despacha; encendido,
  sí.
- **AC5** — Nea con `LLM_API_KEY` vacía piensa por el CRM (pytest con respx y
  e2e contra el CRM local).
- **AC6** — Gates verdes; OpenAPI al día (`openapi.test.ts`).
- **AC7** — En vivo: `vocero20` con Nea **sin** `LLM_API_KEY` contesta un
  WhatsApp real por el relevo, y una corrida corta del Laboratorio pasa.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | La llave de IA no sale del CRM (D4); `/api/bot/llm` exige `BOT_API_KEY`; nada se loguea |
| II Soberanía | Quitar el agente no agrega terceros; el proveedor sigue siendo uno OpenRouter-compatible y opcional |
| IV Idempotencia | El despacho no cambia (dedup por `dispatchId` y `messages[].id`) |
| VI Spec antes de código | Este documento |
| VIII Sin envíos que el cliente no pidió | Sin cambio: el CRM solo despacha lo que el cliente escribió |
| IX Hecho = probado en vivo | AC7 |
