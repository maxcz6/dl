# E2E — Canal de TikTok por Zernio (022)

Arnés: `scripts/e2e-tiktok.mjs`. Spec:
[`specs/022-canal-tiktok/spec.md`](../../specs/022-canal-tiktok/spec.md).

Precondición: app corriendo (`next dev`) sobre una base migrada (036: el CRM
no trae agente; lo que contesta como IA es un cerebro por
`/api/bot/messages`), con `CHANNELS` que incluya
`tiktok` (y `instagram`, para el reparto por plataforma), mocks
(`WA_MOCK_ENABLED=true`, `ZERNIO_BASE_URL` → zernio-mock, `OPENROUTER_BASE_URL`
→ ai-mock con `OPENROUTER_API_TOKEN` y `OPENROUTER_MODEL`), `BOT_API_KEY`
(≥16) y `AGENT_COALESCE_MS=1500`.

El arnés hace de **Zernio**: entrega eventos `message.received` con la forma de
su documentación, firmados con el secreto de la cuenta
(`x-zernio-signature`, HMAC-SHA256 en hex del cuerpo crudo), y lee del mock lo
que el CRM le mandó de vuelta (`GET /api/dev/zernio-mock/_sent`).

```bash
node --env-file=.env scripts/e2e-tiktok.mjs
```

## Conectar

1. **AC14** `PUT /api/settings/tiktok` con una llave que Zernio rechaza → 422
   `invalid_token`, y no se guarda. Con una buena → 200. `GET` enseña el
   `accountId`, el usuario sin arroba, `status = connected`, que hay secreto y
   solo los últimos 4 de la llave; ni la llave ni el secreto salen.
2. **AC15** `GET /api/settings/webhook` → `tiktokUrl` termina en
   `/api/webhooks/tiktok/<token>`. `/api/health` lista `tiktok`.

## Recibir

3. **AC2** Segmento de la URL equivocado → 404. Firma inválida → 401. Ninguno
   deja nada en la bandeja.
4. **AC1** Firma válida → 200, y la conversación aparece con el nombre del
   perfil, canal `tiktok` y el texto del cliente. Por `/api/bot/context`, la
   identidad es `tt:<id>` y la ventana está abierta con más de 24 h por
   delante.
5. **AC3** El mismo evento otra vez → 200 y sigue habiendo un solo entrante.

## Responder

6. **AC8** El cerebro contesta por `POST /api/bot/messages`: el mensaje nace
   `sent` (TikTok no manda acuses), marcado como IA, y Zernio lo recibió en el
   `conversationId` de ese cliente, con el `accountId` y sin etiqueta.
7. **AC7** El operador contesta desde la bandeja y llega a Zernio.

## Los límites de TikTok

8. **AC10** Con dos salientes ya (cerebro y operador), los mensajes 3 al 10
   salen. El **undécimo** → 409 `message_limit`, con un texto que dice «10
   mensajes» y «vuelva a escribir»; no llega a Zernio ni queda en la
   conversación. Por `POST /api/bot/messages`, el mismo 409 `message_limit`.
9. **AC11** El cliente vuelve a escribir: el cerebro contesta y el operador
   vuelve a poder enviar.
10. **AC9** 6,001 caracteres → 422 con el límite dicho, sin llamar a Zernio;
    6,000 caracteres con acento (12,000 bytes) sí salen. Por
    `/api/bot/messages`, 6,001 → 422 `invalid_body`.
11. **AC12** Un mensaje mandado hace 30 horas: la ventana sigue abierta y se
    puede contestar. Uno de hace 49 horas: cerrada, y contestar → 409
    `window_closed` con un texto que dice que TikTok no permite reabrirla;
    nada sale por Zernio.

## Lo que se descarta

12. **AC4** Un evento de otra cuenta, de otra plataforma (X), saliente, de otro
    tipo (`message.sent`) o un cuerpo que no es JSON → 200 y ninguna
    conversación nueva.
13. **AC6** Un adjunto sin texto entra con su tipo (`image`).
14. **AC5** El mismo evento de TikTok entregado a `/api/webhooks/ig/<token>`
    entra como conversación de TikTok.

## En otros arneses y pruebas

- **AC8, con cerebro externo**: `scripts/e2e-despacho.mjs` (sección «022·AC8»)
  comprueba que el turno se despacha con `channel: "tiktok"`, identidad `tt:` y
  `windowExpiresAt` a 48 h, y que el cerebro contesta por `/api/bot/messages`.
- **AC13** (el agente topa con el tope y no traspasa): desde la 036 es
  conducta del cerebro. El CRM solo aplica el tope: 409 `message_limit` por
  `/api/bot/messages` (paso 8), sin traspasar la conversación.
- **AC16** (canal apagado → 404) y **AC17** (los demás canales no cambian): la
  configuración `default` del CI, `tests/unit/tiktok.test.ts`,
  `scripts/e2e-messenger.mjs` y `scripts/e2e-selftest.mjs`.
- **AC18** (Laboratorio): `tests/unit/send-sandbox.test.ts`.

## Comprobaciones a mano

- **La pantalla.** Con `tiktok` en `CHANNELS`, Ajustes → Canales enseña
  «TikTok»: primero las reglas de TikTok, luego el formulario y, ya conectada,
  la URL del webhook. Sin el canal, `/settings/tiktok` da 404 y el enlace no
  existe.
- **El distintivo.** En la bandeja, una conversación de TikTok lleva su
  mosaico negro y se puede filtrar por canal.
- **El compositor.** En una conversación de TikTok con la ventana cerrada, en
  vez del selector de plantillas dice que TikTok no permite reabrirla.
- **AC19 — actualizar.** Sobre una base en `0017`, el migrador aplica `0018` y
  crea `tiktok_credentials` vacía; lo demás no cambia.
