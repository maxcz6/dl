# 031 — Nea entra solo por el despacho

**Feature Branch**: `feat/031-nea-por-despacho` (en `vocero-crm` y en `nea-agent`)

**Created**: 2026-10-19

**Status**: Especificada antes de escribir código. Implementada; gates, e2e del par y prueba en vivo (WhatsApp e Instagram, local y Coolify) en verde. Bitácora del 2026-10-19 y 20.

**Input**: primera pieza de la 2.0.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13): kevinrivm/nea-agent#37. Kevin aprobó en el chat del 2026-10-19
seguir con la 2.0 y las dos recomendaciones abiertas: **el cerebro piensa por
el CRM** (#106) y **una sola base para los dos** (D8).

**Carril**: ciclo completo (Principio VI). Cambia un contrato publicado —el
despacho gana llaves y `/api/bot/context` gana `adOrigen`—, aunque solo de
forma aditiva, y cambia la topología con la que se instala el par. Plan en
[plan.md](plan.md), tareas en [tasks.md](tasks.md); el contrato se enmienda en
[`021/contracts/despacho.md`](../021-despacho-estandar/contracts/despacho.md).

## Problema

Hoy, con Vocero raíz, Meta le manda el webhook a Nea y Nea se lo reenvía al
CRM (el «relay»). Eso tiene tres costos:

1. **Nea solo contesta WhatsApp.** Los DMs de Instagram, Messenger y TikTok
   llegan al CRM por Zernio y Nea nunca los ve: en una instancia con Nea esos
   canales los atiende el agente incluido o nadie.
2. **El secreto de la app de Meta vive en dos lugares** y Nea mantiene una
   cola de reenvío, con su espera, sus reintentos y su propia forma de fallar.
3. **Hay dos maneras de conectar el par**: relay contra la raíz y despacho
   contra cloud. Cada arreglo de transporte se hace dos veces.

Desde la 021 el CRM ya sabe despachar a un cerebro (recibe, guarda, agrupa la
ráfaga y la entrega firmada). Nea lo sabe recibir, pero solo en modo cloud.

## Historias

**H1 — Nea contesta todos los canales.** Un DM de Instagram, de Messenger o de
TikTok le llega a Nea igual que un WhatsApp, y Nea contesta por el CRM.

**H2 — Instalar el par es más simple.** Meta le manda el webhook solo al CRM.
Nea no necesita ni el secreto de la app de Meta ni la URL del webhook del CRM;
le basta la URL del CRM y la llave de `/api/bot/*`.

**H3 — Nea no pierde nada de lo que le daba el webhook.** El anuncio del que
llegó el lead, la ubicación que comparte, la tarjeta de contacto y el nombre
del documento le siguen llegando, ahora por el CRM.

**H4 — Quien actualiza no pierde mensajes.** Si Meta todavía le manda el
webhook a Nea 2.0, Nea no lo descarta en silencio: avisa y Meta reintenta.

## Decisiones

**D1 — El despacho es la única entrada de Nea, en los dos modos.**

| | Estándar (contra la raíz) | Cloud (contra Vocero Cloud) |
|---|---|---|
| Entrada | `POST /vocero/dispatch` | `POST /vocero/dispatch` (sin cambios) |
| Firma de lo que entra | `CRM_BOT_API_KEY` | `CRM_BRAIN_SECRET` (sin cambios) |
| Salida | `/api/bot/*` con `X-API-Key` (sin cambios) | `/api/brains/*` (sin cambios) |
| Seguimiento a las 4 h | Sí, como siempre | No, como siempre |

El modo lo sigue diciendo `VOCERO_MODE`. Entrada y salida dejan de ir atadas:
la entrada es la misma para los dos.

**D2 — Sale lo que existía solo por estar delante del CRM.** `app/webhook.py`,
`app/relay.py`, `app/coalesce.py`, el worker del relay, el bloque `relay` de
`/health` y las variables `META_APP_SECRET`, `VERIFY_TOKEN`, `CRM_WEBHOOK_URL`,
`RELAY_BACKOFF_CAP_SECONDS`, `COALESCE_SECONDS` y `TYPING_DELAY_SECONDS`. Una
variable vieja en el entorno se ignora; si están `META_APP_SECRET` o
`CRM_WEBHOOK_URL`, Nea avisa al arrancar que ya no se usan. **Se queda todo lo
que es conducta**: turno, herramientas, adjuntos, candado de cierre,
seguimiento, hostilidad, formato, prompt, perfil y agenda.

**D2b — Salen también los reintentos del turno (`TURN_RETRY_DELAYS`).**
Decidido durante la implementación, al ver que solo corrían en el camino del
webhook: Nea 1.x repetía la ráfaga hasta diez minutos porque el relay podía no
haberle entregado el mensaje al CRM todavía. Con el despacho el CRM acaba de
mandarlo; si no contesta al leer el contexto, el error sube a la cola durable,
que le pasa la conversación a una persona (`error`) en cuanto el CRM vuelva.
Es lo que ya hacía cloud.

**D3 — La tabla `relay_queue` se queda, sin uso, en esta versión.** Puede
guardar mensajes que el relay no alcanzó a entregar antes de actualizar; una
actualización no tira datos. Se borra en una versión siguiente.

**D4 — Un webhook de Meta que siga llegando a Nea responde 503, no 404.**
`POST /webhook` y `POST /webhook/<algo>` contestan 503 y dejan un error en el
log (como mucho uno por minuto) que dice qué hacer: devolverle el webhook al
CRM. Con 503, Meta reintenta en vez de dar el mensaje por entregado, y en
cuanto el webhook apunta al CRM los mensajes siguen llegando. `/health` lo
enseña en `webhookDeMeta.ultimoEn` para que el CRM o quien instala lo vea. La
verificación (`GET`) responde 404: no se puede suscribir a Nea a Meta.

**D5 — Lo que Nea leía del webhook y el despacho no traía, ahora lo trae el
CRM.** Cambios aditivos en la raíz:

| Dato | Antes (webhook a Nea) | Ahora |
|---|---|---|
| Anuncio de origen (titular) | `referral` del mensaje | `adOrigen` en `GET /api/bot/context`, la misma llave que ya manda Vocero Cloud y que Nea ya lee |
| Ubicación | `location` del mensaje | `location` en el mensaje del despacho, solo si `type` es `location` |
| Tarjeta de contacto | `contacts[].name` | `contacts` (los nombres) en el mensaje del despacho, solo si `type` es `contacts` |
| Nombre del documento | `document.filename` | `fileName` en el mensaje del despacho, solo si el adjunto tiene nombre |
| Nota de voz o audio | `audio.voice` | Nea lo deduce del tipo: `audio/ogg` es nota de voz. Solo cambia la palabra que lee el modelo |

Las llaves nuevas del despacho van **solo cuando aplican**, igual que
`mimeType` y `caption`: el cuerpo fijado en la prueba gemela no cambia.

**D6 — Nea lee el canal.** `conversation.channel` del despacho llega al
prompt: el agente sabe que lo atienden por Instagram, Messenger, TikTok o
WhatsApp y no dice «por WhatsApp» en un DM de Instagram. El formato sigue
saliendo como WhatsApp: el CRM se lo quita en las redes (024).

**D7 — Nea deduplica por mensaje en los dos modos.** El despacho de la raíz
también repite la ráfaga completa (025). Lo que en cloud ya se hacía
(`messages[].id`, anotado al entrar al historial) vale ahora para el estándar.

**D8 — Una sola base para los dos (aprobada el 2026-10-19).** Variable nueva
`DATABASE_SCHEMA` (vacía = `public`, como hoy). Con `DATABASE_SCHEMA=nea`, Nea
crea su esquema si no existe y guarda ahí sus tablas, así que puede usar el
mismo Postgres que el CRM sin pisarse con él. El `docker compose` que levanta
los dos con una sola base es de la #92.

**D9 — El contexto se pide por conversación.** Con despacho, Nea ya sabe qué
conversación es: `GET /api/bot/context?conversationId=…`, no por identidad. El
seguimiento, que despierta horas después y sin despacho, sigue preguntando por
identidad.

**D10 — Fuera de esta spec**, cada cosa con su issue:

- Roles y herramientas encendidas (#90): Nea leerá `role` y `tools` cuando el
  perfil los traiga.
- Laboratorio por contrato (#91): conversaciones de prueba y olvido entre
  corridas.
- **El cerebro piensa por el CRM (#106, aprobado el 2026-10-19):** cuando la
  raíz ofrezca `/api/bot/llm`, Nea lo usará como ya usa `/api/brains/llm` en
  multi-organización, y `LLM_API_KEY` quedará de respaldo. Hasta entonces Nea
  sigue con su propia llave.
- «Recuperar el webhook» en Ajustes → WhatsApp, el `docker compose` del par y
  la guía de migración (#92).

**D11 — Versiones.** Nea sube a **2.0.0**: quien actualiza tiene que mover el
webhook de Meta al CRM y configurar el despacho en el CRM. Del lado del CRM el
cambio es aditivo y viaja en la 2.0.0 del CRM; **Nea 1.x frente a un CRM 2.0
sigue funcionando**, porque `/api/bot/*` no cambia.

## Criterios de aceptación

- **AC1** — En modo estándar, un despacho firmado con `CRM_BOT_API_KEY` se
  acepta y se contesta por `/api/bot/messages`. Firmado con otra llave, o sin
  firma: 401.
- **AC2** — El cuerpo fijado en `tests/unit/despacho-contrato.test.ts`, con su
  firma, se acepta tal cual en Nea (prueba gemela nueva en `nea-agent`).
- **AC3** — Un despacho de Instagram, uno de Messenger y uno de TikTok reciben
  respuesta, y el prompt nombra el canal correcto.
- **AC4** — Un mensaje repetido en dos despachos entra una sola vez al
  historial de Nea, también en modo estándar.
- **AC5** — Con un anuncio de origen guardado en el CRM, el primer saludo del
  agente lo menciona (como hacía con el `referral` del webhook).
- **AC6** — Una ubicación, una tarjeta de contacto y un PDF con nombre llegan a
  Nea con sus datos: el texto que ve el modelo trae coordenadas, nombres y
  nombre del archivo, no `None`.
- **AC7** — `POST /webhook` a Nea 2.0 responde 503, deja el error en el log y
  marca `webhookDeMeta.ultimoEn` en `/health`.
- **AC8** — Con `DATABASE_SCHEMA=nea` sobre la base del CRM, las migraciones de
  Nea crean sus tablas en `nea` y las del CRM no se tocan.
- **AC9** — Los nueve escenarios de `scripts/e2e_contra_raiz.py`, con la
  topología nueva, en verde:
  1–6 iguales (primer contacto, estados, agenda, contexto de la cita, handoff,
  candado), con el cliente escribiéndole al **CRM**;
  7 «Nea caída»: el mensaje queda en la bandeja y, agotados los reintentos del
  despacho, la conversación pasa a un humano;
  8 «Nea sin webhook»: Nea 2.0 responde 503 a un webhook de Meta y el CRM es
  quien recibe;
  9 salud: `/health` en modo estándar, sin bloque `relay`.
- **AC10** — Gates de los dos repos en verde: en el CRM `pnpm typecheck`,
  `lint`, `test`, `build` y los E2E del despacho; en Nea, `pytest`.
- **AC11** — En vivo: un WhatsApp real de la línea cliente y un DM real de
  Instagram contestados por Nea a través del CRM, primero en local con túnel y
  luego en Coolify.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | La firma usa la misma llave que ya autentica `/api/bot/*`; ningún secreto nuevo viaja. Nea deja de guardar el secreto de la app de Meta. |
| II Soberanía | Nada nuevo de terceros. El par sigue siendo CRM + Nea + proveedor de IA. |
| III Multi-tenancy | `adOrigen` sale por `scoped()` de la organización de la llave. |
| IV Idempotencia | Dedup por `dispatchId` y por `messages[].id` en los dos modos; la cola durable de cloud sirve a los dos. |
| V Pruebas en vivo con permitidos | `ALLOWED_WA_IDS` de Nea sigue siendo la puerta: una instancia de pruebas con Nea ya no contesta a desconocidos, cosa que la raíz sola no tiene. |
| VI Spec antes de código | Este documento, antes de la primera línea. |
| VIII Sin envíos que el cliente no pidió | Ningún envío nuevo: el seguimiento es el de siempre. |
| IX Hecho = probado en vivo | AC11. |

## Pendiente que esta spec no resuelve

- Quien hoy tiene Nea 1.x delante del CRM y actualiza Nea antes de mover el
  webhook ve el error de D4 hasta moverlo. El botón para moverlo desde la
  interfaz llega con la #92; hasta entonces, la guía de la 2.0 dice cómo
  hacerlo con la Graph API.
