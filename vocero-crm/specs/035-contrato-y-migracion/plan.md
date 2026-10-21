# 035 — Plan

Spec: [spec.md](spec.md).

## Constitution Check (antes de la Fase 0)

Sin violaciones.

## Fase 0 — Lo que se investigó

| Pregunta | Respuesta |
|---|---|
| ¿Qué rutas tiene `/api/bot`? | `availability` (GET), `bookings` (POST, PATCH), `context` (GET), `ficha` (PUT), `handoff` (POST), `media/[mediaId]` (GET), `messages` (POST), `profile` (GET), `reset` (POST), `typing` (POST) |
| ¿Dónde están los cuerpos gemelos? | `tests/unit/despacho-contrato.test.ts` (`CUERPO`, `FIRMA`) y `tests/unit/olvido-contrato.test.ts` |
| ¿Cómo se salta hoy el registro? | `registerWebhookForNumber` mira `GET /{waba}/subscribed_apps`; con un override ajeno devuelve `skipped: "waba_override"` y quita el del número si era suyo |
| ¿Qué ofrece hoy la tarjeta del webhook? | `POST /api/settings/webhook` vuelve a registrar «a demanda», con la misma regla |
| ¿Qué valida `manifests-plataformas`? | Imagen fijada a la versión del `package.json`, puerto, healthcheck, volumen y variables obligatorias en Render, Fly y Railway |

## Fase 1 — Diseño

1. `docs/openapi.json` y `GET /api/bot/openapi.json` (lee el archivo, sin llave).
2. `tests/unit/openapi.test.ts` (D2): exporta los cuerpos gemelos desde sus pruebas o los relee del OpenAPI y compara contra `armarEvento`/`construirEventoOlvido` de los mismos datos.
3. `registerWebhookForNumber({ forzar })` y `POST /api/settings/webhook` con `{recuperar: true}` (403 sin `canConfigure`).
4. Tarjeta del webhook (`whatsapp-wizard.tsx`): botón «Recuperar el webhook» cuando la última respuesta fue `skipped`, con confirmación.
5. `docker-compose.yml` con `nea`; `render.yaml` con el segundo servicio; comentarios en `fly.toml` y `railway.toml`; `.env.example` con `NEA_VERSION` y `LLM_API_KEY` para Nea.
6. `docs/migrar-a-2.0.md`; README («Trae tu propio agente», «Instalación», «Versiones»); `INSTALL-IA.md`; CHANGELOG.
7. `scripts/e2e-recuperar-webhook.mjs` contra el wa-mock.

## Constitution Check (después del diseño)

Sin cambios.
