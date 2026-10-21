# E2E — Texto del agente en redes y ventana humana (024)

Arnés: `scripts/e2e-ventana-social.mjs`. Spec:
[`specs/024-texto-social-ventana-humana/spec.md`](../../specs/024-texto-social-ventana-humana/spec.md).

Precondición: app corriendo (`next dev`) sobre una base migrada, **sin**
`BRAIN_DISPATCH_URL`, con `CHANNELS=whatsapp,instagram,messenger,tiktok`,
simuladores (`WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`ZERNIO_BASE_URL` → zernio-mock, `OPENROUTER_BASE_URL` → ai-mock con
`OPENROUTER_API_TOKEN` y `OPENROUTER_MODEL`), `BOT_API_KEY` y
`AGENT_COALESCE_MS=1500`.

El arnés hace de **cliente** (entrega eventos firmados de Zernio; con `sentAt`
viejo para envejecer la ventana), de **cerebro** (`POST /api/bot/messages`) y
de **persona** (la bandeja), y lee lo que salió hacia cada plataforma
(`/api/dev/zernio-mock/_sent`, `/api/dev/wa-mock/outbox`).

```bash
node --env-file=.env scripts/e2e-ventana-social.mjs
```

## D1 — El texto de la IA sale plano en redes

1. Por Instagram, Messenger y TikTok: el cerebro manda un texto con negritas,
   cursivas, tachado, viñetas y un enlace de Markdown → 200. A la plataforma
   llega sin marcas, con `•` en las viñetas y el enlace como `texto: URL`. En
   el hilo queda ese mismo texto, marcado como IA.
2. Lo que escribe una persona en la bandeja, con asteriscos → sale tal cual.
3. Por WhatsApp el mismo texto del cerebro sale con su formato y así se guarda.

## D3 — Quién puede escribir pasadas 24 horas (Instagram y Messenger)

4. **23 horas**: la bandeja la da por abierta; la respuesta sale sin etiqueta.
5. **30 horas**: `windowOpen: false` y `humanWindow.open: true` con unos 6 días
   por delante. La IA → 409 `window_closed` que dice que solo contesta una
   persona, y a la plataforma no sale nada. Una persona → 200, con
   `MESSAGE_TAG` / `HUMAN_AGENT`. Contestar no alarga el plazo.
6. **8 días**: `humanWindow.open: false`. Ni la persona (409 `window_closed`
   que dice 7 días) ni la IA. No sale nada.
7. El cliente vuelve a escribir → la ventana se reabre y la IA contesta.

## Los demás canales no cambian

8. TikTok a las 30 horas: `humanWindow: null`, su ventana de 48 horas sigue
   abierta y la IA contesta. WhatsApp: `humanWindow: null`.

## El agente incluido (ya no aplica)

9. 036 — El CRM no trae agente: todo texto de IA llega por
   `/api/bot/messages` y pasa por el mismo `sendText` del paso 1. No hay un
   segundo camino que probar.

## Interfaz (a mano, claro y oscuro)

- Conversación de Instagram a las 30 horas: el cuadro de texto está, con el
  aviso «Solo puede contestar una persona», el pie «Ventana humana · quedan 5
  días» y el encabezado «ventana humana».
- A los 8 días: aviso de ventana cerrada, sin cuadro de texto ni plantillas.
- Dentro de 24 horas: como siempre, «Ventana abierta · quedan …».
