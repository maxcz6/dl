# Research — 001-vocero-core

> Decisiones de diseño verificadas (DV-VC-n). Los patrones marcados como "proyecto de
> referencia privado en producción" provienen de un sistema real en producción cuyo
> código no forma parte de este repositorio; aquí solo se documenta el patrón.

## DV-VC-01 — Tiempo real: SSE, no WebSocket

**Decisión**: `GET /api/events` con Server-Sent Events; EventSource en el cliente.

**Racional**: Next.js App Router self-hosted no expone un servidor WS sin proceso
adicional; SSE es HTTP plano → atraviesa Caddy/Traefik/Coolify sin configuración. La
bandeja solo necesita server→cliente. EventSource reconecta solo.

**Requisitos duros** (fallan silenciosamente detrás de proxies si se omiten):
`Content-Type: text/event-stream` exacto, `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`, heartbeat `: ping` cada ~25s, `force-dynamic`. Catch-up por
refetch con `since=` al reconectar (el servidor no garantiza replay). Verificar ≤2s
tanto en `pnpm dev` como a través de compose+Caddy.

**Alternativas descartadas**: WebSocket (proceso extra o custom server → rompe
standalone), polling (latencia/carga).

## DV-VC-02 — Webhook: dos capas de autenticación

**Decisión**: Ruta `/api/webhooks/wa/[webhookToken]`.
- **Capa 1 (siempre)**: el segmento debe coincidir (comparación timing-safe) con
  `META_WEBHOOK_VERIFY_TOKEN`; si no → 404 sin efectos secundarios.
- **Capa 2 (opcional)**: si `META_APP_SECRET` está configurado, validar
  `x-hub-signature-256` = HMAC-SHA256 del **body crudo** (leer `req.text()` ANTES de
  parsear JSON); inválida → 401. Sin secret → aviso informativo en Settings, no error.

GET = handshake de verificación (`hub.mode=subscribe` + token → devolver
`hub.challenge` plano). POST siempre responde 200 tras validar (Meta reintenta y puede
desactivar el webhook ante errores repetidos); el procesamiento pesado va en `after()`.

**Origen**: proyecto de referencia privado en producción + docs oficiales de Meta.

## DV-VC-03 — Enrutamiento del payload de Meta

- Mensajes/status llegan por `entry[].changes[].value` con `metadata.phone_number_id`
  → resolver credencial/org por `phone_number_id` (UNIQUE en `meta_credentials`).
- `message_template_status_update` llega a nivel WABA → enrutar por `entry[].id`
  (= WABA ID).
- Idempotencia: `message.wa_message_id` UNIQUE +
  `.onConflictDoNothing({ target }).returning()` → si no devuelve fila, ya existía
  (no re-disparar agente ni SSE).
- Status monotónicos: `pending < sent < delivered < read`; nunca degradar (un
  `delivered` tardío no pisa `read`). `failed` siempre aplica.

## DV-VC-04 — Modo agencia: override de callback por WABA (verificado contra docs oficiales)

**Sintaxis verificada** (Graph API **v25.0**, vigente feb-2026):

```
POST https://graph.facebook.com/v25.0/{WABA_ID}/subscribed_apps
Authorization: Bearer {token con whatsapp_business_management}
{ "override_callback_uri": "https://cliente.com/api/webhooks/wa/<token>",
  "verify_token": "<META_WEBHOOK_VERIFY_TOKEN del cliente>" }
```

- Meta hace el handshake GET contra la URI en el momento del POST; inalcanzable → 422.
- `GET {WABA_ID}/subscribed_apps` muestra el override; POST sin esos campos lo
  elimina; DELETE desuscribe la app por completo.
- **Limitación confirmada**: los webhooks de plantillas
  (`message_template_status_update`) **NO siguen el override** — van solo al callback
  de la app. Compensación: sincronización por Graph API
  (`GET {WABA_ID}/message_templates`) con botón "Sincronizar" + poll al abrir la
  pestaña de plantillas. Documentar honestamente en README (modo agencia).
- Tras conectar en modo directo también se ejecuta `POST {WABA_ID}/subscribed_apps`
  (sin override) best-effort — necesario para que la app reciba webhooks de esa WABA.
  **Solo si la WABA no tiene ya un override**: antes se consulta
  `GET {WABA_ID}/subscribed_apps` y, si alguna app trae `override_callback_uri`,
  no se re-suscribe (ese POST sin campos lo borraría y desconectaría al backend
  de la agencia o al cerebro externo). Si la consulta falla, se suscribe igual.

## DV-VC-05 — Cifrado de credenciales: AES-256-GCM

Clave de 32 bytes desde `ENCRYPTION_KEY` (base64, 44 chars), IV de 12 bytes aleatorio
por operación, almacenar `token_cipher`/`token_iv`/`token_tag` por separado. GCM da
integridad (tag) además de confidencialidad. Nunca loguear el token; al cliente solo
`last4` + estado. **Origen**: proyecto de referencia privado en producción.

## DV-VC-06 — Adaptador LLM único (`chatJson<T>`)

Un solo cliente `fetch` OpenRouter-compatible como frontera. 3 intentos con
instrucción STRICT en reintento; extracción robusta (fence ```json, fallback primer
`{` → último `}`); Zod al final; jamás loguear la key. Fallo agotado → resultado
`error` tipado, nunca excepción al turno (regla operativa: un hipo del proveedor no
tumba el turno). `OPENROUTER_JUDGE_MODEL` default = `OPENROUTER_MODEL`. Sin token →
estados vacíos (nunca ai-mock como fallback fuera de dev).

## DV-VC-07 — Turno del agente: coalesce + lock in-process

Map en memoria por `conversation_id` con `{ timer, running, pending }`: debounce
`AGENT_COALESCE_MS` (6000 prod / 0 Laboratorio); si llega mensaje durante el turno →
`pending=true` → re-ejecutar una vez al terminar. Suficiente para monolito de una
instancia (decisión de alcance v1: sin cola externa — Principio II). Regex de respaldo
de handoff se evalúa ANTES del LLM. Acciones validadas server-side contra allowlists
(etapas de la org); sin match → degradar a `reply`/`none`. **Origen**: proyecto de
referencia privado en producción, simplificado.

## DV-VC-08 — Laboratorio: ejecución in-process

POST fire-and-forget dentro del mismo proceso Node (sin cola, sin worker): el handler
crea el run y dispara la corrida async; progreso vía SSE `lab.run` + GET de detalle.
Turnos secuenciales (persona por persona, mensaje por mensaje, debounce 0). Lock de
concurrencia por **BD** (índice parcial UNIQUE `(organization_id) WHERE
status='running'`) — sobrevive a múltiples réplicas mejor que un lock en memoria y da
409 limpio. Timeout 10 min → `failed`; al boot (`instrumentation.ts`) marcar `running`
huérfanos → `failed`. Sandbox: conversaciones `is_test=true`; el sender de WhatsApp
**lanza excepción** si recibe una conversación de test (aserción dura + unit test).
Juez: UNA llamada por conversación (6 por corrida), `judge_failed` excluido del score
`round(100 * (verdes + 0.5*amarillos) / casos_con_veredicto)`.

## DV-VC-09 — Mocks para self-test (wa-mock + ai-mock)

- **Interception por env**: `META_GRAPH_BASE_URL` → wa-mock/graph;
  `OPENROUTER_BASE_URL` → ai-mock. El código de producción no sabe que existe el mock.
- wa-mock firma los entrantes con el `META_APP_SECRET` real y hace POST **loopback**
  (`http://127.0.0.1:PORT`, no la URL pública) al webhook; outbox en memoria (válido:
  mismo proceso Node). Overrides `waMessageId`/`timestamp` para tests de dedup y
  ventana 24h; token con sufijo `-invalid` → 401 code 190 (camino infeliz wizard).
- ai-mock: despacho determinista por contenido (marcador `[JUEZ]` en el prompt del
  juez → veredictos fijos). Los E2E del Laboratorio SIEMPRE corren contra ai-mock
  (determinismo).
- Gate doble: `WA_MOCK_ENABLED=true` **y** `NODE_ENV !== 'production'` → si no, 404
  (unit test). `WA_MOCK_ENABLED` no aparece en `.env.example`.

**Origen**: wa-mock adaptado del proyecto de referencia privado en producción
(extendido con overrides y ciclo de plantillas); ai-mock nuevo.

## DV-VC-10 — Env: validación lazy + placeholders de build

`getEnv()` lazy + memoizada (Zod). Durante `next build`
(`NEXT_PHASE === 'phase-production-build'`) se aceptan placeholders → los secretos son
**solo runtime**, nunca build args (la imagen Docker se construye sin secretos).
**Origen**: proyecto de referencia privado en producción.

## DV-VC-11 — Docker: migraciones al arranque, no pre-deploy

Multi-stage `node:22-alpine` + corepack pnpm + Next standalone. `migrate.mjs`
bundleado con esbuild (drizzle-orm/postgres-js/migrator, `max:1`,
`onnotice:()=>{}`). `CMD ["sh","-c","node migrate.mjs && node server.js"]` — migrar
al **boot del contenedor nuevo**: en Coolify el Pre-Deployment Command corre en el
contenedor VIEJO (gotcha real → columnas faltantes). HEALTHCHECK `/api/health` con
`start-period` 40s (cubre la migración). Ruta B: compose app+postgres+caddy, Caddy
con `{$DOMAIN}` (TLS automático).

## DV-VC-12 — Normalización de destinatarios (México)

`normalizeRecipient`: si el número es `521` + 10 dígitos (13 total) → `52` + últimos
10 (el `1` de móvil legado provoca error 131030 de Meta al enviar). Aplicar solo al
**enviar**; almacenar el `wa_id` tal como llega. **Origen**: proyecto de referencia
privado en producción.

## DV-VC-13 — Detección de token vencido

Respuesta Graph con status 401 / `code: 190` / `type: OAuthException` → estado
`reconnect_required` en `meta_credentials`; banner en Settings + envíos bloqueados con
error tipado (no reintentos ciegos).

## DV-VC-14 — Versiones fijadas (stack)

`next ^15.1`, `react ^19`, `drizzle-orm ^0.38` + `drizzle-kit ^0.30`,
`better-auth ^1.1` (+ organization plugin), `zod ^3.24` (**no** v4 — breaking),
`tailwindcss ^3.4`, `postgres ^3.4`, `nanoid ^5` (IDs prefijados), `vitest ^2.1`,
`@dnd-kit/core` (kanban), esbuild (bundle migrate), pnpm (packageManager pinneado),
`"type": "module"`, Next 15: `after()` para post-response, `params` como Promise.
Graph API `v25.0` por defecto (`META_GRAPH_API_VERSION` configurable).

## DV-VC-15 — Plantillas: modelo y envío

Una variable máx (`{{1}}`), `countVariables` con `/\{\{\s*(\d+)\s*\}\}/g`. Envío:
payload `{ messaging_product, to, type: 'template', template: { name,
language: { code }, components?: [{ type: 'body', parameters: [{ type: 'text',
text }] }] } }`; solo `approved` y con la variable si el body la tiene. Estado por
webhook (modo directo) **más** sync por Graph (ambos modos, cubre la limitación
DV-VC-04). Errores tipados → HTTP: `not_connected/reconnect_required → 409`,
`invalid/meta_error → 422`, `meta_unavailable → 503`, `not_found → 404`.
**Origen**: proyecto de referencia privado en producción.

## DV-VC-16 — Seed demo idempotente

"Ferretería El Martillo": DELETE scoped a la org demo en orden inverso de FKs →
reinsertar. KB con 1–2 huecos INTENCIONALES (garantías y devoluciones) para que el
Laboratorio demuestre hallazgos reales en la primera corrida; incluye una corrida de
ejemplo guardada. Ejecutable por botón (solo BD de dominio vacía) y `pnpm seed:demo`.
