# Implementation Plan: Canal de TikTok

**Branch**: `feat/022-canal-tiktok` | **Spec**: [spec.md](spec.md)

## Summary

Un canal más sobre los cimientos de 014 y 017: catálogo, capacidades
declaradas, adaptador propio y núcleo compartido. Lo nuevo respecto a
Messenger es que el canal trae límites que ningún otro tiene (ventana de 48 h
sin forma de reabrir, tope de mensajes, longitud en caracteres), así que las
capacidades ganan tres campos y la ventana pasa a preguntarse por canal.

## Modelo de datos

`tiktok_credentials` (migración `0018_canal_tiktok`), con la forma de
`messenger_credentials`:

| Columna | Tipo | Nota |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text NOT NULL, FK cascade | único: una cuenta por organización |
| `source` | text NOT NULL default `zernio` | enum de un valor |
| `account_ref` | text NOT NULL | `accountId` de Zernio; por él enruta el webhook. Único. |
| `username` | text NULL | para enseñarlo en Ajustes |
| `token_cipher`, `token_iv`, `token_tag` | text NOT NULL | la API key, cifrada |
| `webhook_secret` | text NULL | secreto HMAC de las entregas |
| `status` | text NOT NULL default `connected` | `connected` o `reconnect_required` |
| `created_at`, `updated_at` | timestamp | |

`contact.channel` y `conversation.channel` son `text` con enum de TypeScript:
aceptar `tiktok` no genera SQL.

## Contratos

- **`POST /api/bot/messages`** — nuevo 409 `message_limit`: el canal no admite
  más mensajes hasta que el cliente escriba. Se suma a `ai_paused`,
  `window_closed` y `sandbox_violation`. `window_closed` ya existía; ahora
  también lo devuelve un canal sin forma de reabrir la ventana.
- **`POST /api/bot/messages`** — el tope de `text` pasa de 4,096 a 6,000
  caracteres en el esquema; el límite real es el del canal y un texto que no
  cabe sigue respondiendo 422 `invalid_body`.
- **`GET /api/bot/context`** — `windowOpen` y `windowRemainingMs` usan la
  ventana del canal. Misma forma.
- **Despacho** — `conversation.channel` puede valer `tiktok`;
  `windowExpiresAt` usa la ventana del canal. Misma forma, misma firma.
- **`GET /api/settings/webhook`** — gana `tiktokUrl` (API interna).
- **`/api/webhooks/tiktok/[token]`** — `POST` de Zernio; 404 con el canal
  apagado o el segmento equivocado, 401 con firma inválida, 200 si no.

## Diseño

1. `lib/channels.ts`: `tiktok` en `Channel`, orden y etiqueta.
2. `server/channels/capabilities.ts`: `maxTextChars`,
   `maxOutboundPerWindow`; `textFits` mira bytes y caracteres;
   `windowMsFor(channel)`.
3. `server/inbox/window.ts`: `isWindowOpen` y `windowRemainingMs` aceptan la
   duración; `windowExpiresAt`. Los que llaman pasan la del canal.
4. `server/inbox/outbound-cap.ts`: cuántos salientes no fallidos hay desde el
   último entrante (una consulta), y la decisión pura.
5. `server/tiktok/{credentials,ingest,send}.ts`.
6. `server/zernio/`: `tiktok` en el reparto y en la resolución del secreto;
   `sendZernioMessage` lee también `data.messageId`, que es donde la API real
   devuelve el id.
7. `server/inbox/send.ts`: rama de TikTok en `prepareSend` (canal encendido,
   credenciales, ventana, tope) y `callTiktokSend`; `SendError` gana
   `message_limit`.
8. `server/ai/pipeline.ts`: `message_limit` al entregar la respuesta se
   registra y no traspasa.
9. Rutas: webhook, `/api/settings/tiktok`, `tiktokUrl` en
   `/api/settings/webhook`; mapeo de `message_limit` a 409.
10. UI: `settings/tiktok`, enlace en Ajustes → Canales, distintivo, texto del
    compositor con la ventana cerrada o el tope alcanzado.

## Project Structure

```text
src/lib/channels.ts, src/lib/db/schema.ts, drizzle/0018_*.sql
src/server/channels/capabilities.ts
src/server/inbox/{window,outbound-cap,send,identity,queries}.ts
src/server/tiktok/{credentials,ingest,send}.ts
src/server/zernio/{index,dispatch}.ts
src/server/ai/pipeline.ts, src/server/brains/{contract,deliver}.ts
src/server/whatsapp/webhook-url.ts
src/app/api/webhooks/tiktok/[webhookToken]/route.ts
src/app/api/settings/tiktok/route.ts, src/app/api/settings/webhook/route.ts
src/app/api/bot/{messages,context}/route.ts
src/app/api/conversations/[id]/messages/route.ts (y media)
src/app/(app)/settings/tiktok/page.tsx, settings/layout.tsx
src/components/settings/{tiktok-client,settings-nav}.tsx
src/components/channel-badge.tsx, src/components/inbox/composer.tsx, src/lib/nav.ts
tests/unit/tiktok.test.ts (+ nav, health, contrato)
tests/e2e/us-tiktok.md, scripts/e2e-tiktok.mjs
AGENTS.md, README.md, .env.example, CHANGELOG.md, specs/README.md
```

## Verificación

- Los cuatro gates en las dos configuraciones del CI; `ci.yml` añade `tiktok`
  a la configuración completa.
- `scripts/e2e-tiktok.mjs` contra el mock de Zernio; `e2e-messenger.mjs`,
  `e2e-despacho.mjs` y el selftest siguen en verde.
- Migración sobre una base en `0017`.
- En vivo: ver el Constitution Check (IX).
