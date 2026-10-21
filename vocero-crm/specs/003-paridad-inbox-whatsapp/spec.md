# Feature Specification: Paridad WhatsApp del inbox — mensajes manuales (coexistence) y adjuntos con previsualización

**Feature Branch**: `feat/paridad-inbox`

**Created**: 2026-08-04

**Status**: Implemented

## Resumen

Dos capacidades de paridad con WhatsApp para el inbox:

1. **Echoes de coexistence** (`smb_message_echoes`): cuando el negocio usa
   coexistence (el número conectado sigue activo en la app de WhatsApp
   Business del teléfono), los mensajes que el dueño envía a mano desde la
   app hoy son invisibles para el CRM y la IA puede contestarle al lead
   encima del dueño. Con esta feature, cada mensaje manual aparece en el
   hilo como saliente de origen "manual" (badge 📱) y **pausa la IA en esa
   conversación** (handoff `manual_reply`, reactivable con el flujo
   existente). Requiere suscribir el campo `smb_message_echoes` en la app de
   Meta.
2. **Adjuntos de punta a punta**: el composer envía imagen/video/audio/
   documento (con caption y validación de límites ANTES de tocar la API:
   imagen 5 MB, audio/video 16 MB, documento 100 MB), ubicación y contacto;
   los adjuntos entrantes y salientes se previsualizan en el hilo (imagen
   ampliable, audio/video reproducibles, documento descargable, ubicación
   con enlace, contacto). Los archivos se copian a un volumen local
   (`MEDIA_DIR`, sin S3/R2 — constitución II) y se sirven SOLO por
   `GET /api/media/[assetId]` con sesión y scope de organización — siguen
   disponibles después de que Meta los expire (~30 días).

## Requisitos clave

- **FR-1**: echo → mensaje `direction=out`, `origin=manual`, `status=sent`,
  idempotente por `wa_message_id`; crea contacto/conversación si no existen;
  JAMÁS altera `lastInboundAt` ni la ventana de 24 h; jamás dispara la IA.
- **FR-2**: echo → handoff automático `manual_reply` (solo si no hay handoff
  activo — atómico), visible en el inbox y reactivable.
- **FR-3**: columna `message.origin` (`ai|operator|manual|template`) con
  backfill; la UI distingue el origen del saliente.
- **FR-4**: tabla `media_asset` multi-tenant (`organization_id` NOT NULL)
  con `fetchStatus available|pending|failed`; descarga in-process
  post-ingesta que nunca bloquea el webhook + reintento on-demand; si Meta
  ya expiró el archivo → 410 y la UI muestra "contenido no disponible".
- **FR-5**: envío de archivo = validación previa (413/415) → disco local →
  upload a Graph (`POST /{phone_number_id}/media`) → send por media id; un
  fallo de Graph persiste el mensaje `failed` con el asset ya en disco
  (nunca se pierde en silencio). Ubicación/contactos viajan como payload
  estructurado sin binario.
- **FR-6**: sandbox del Laboratorio intacto: conversaciones `is_test` jamás
  suben ni envían nada real (mismo pre-flight compartido que el texto).
- **FR-7**: mocks de dev (`wa-mock/echo`, media upload/download en el mock
  de Graph, inbound con adjuntos) tras el dev-guard; secciones E2E en
  `scripts/e2e-selftest.mjs` y guion en `tests/e2e/008-paridad-inbox.md`.

## Fuera de alcance

Sincronización del historial previo de coexistence (`history` /
`smb_app_state_sync`), grabación de audio en el navegador, envío de
stickers (entrantes sí se muestran), purga programada del volumen de media.

## Despliegue

- Montar un volumen persistente en `/data`: la imagen ya trae
  `MEDIA_DIR=/data/media`. El Dockerfile crea el punto de montaje con el
  dueño correcto (un volumen nombrado nuevo lo hereda al montarse vacío) y
  `vocero-entrypoint.sh` arregla al arrancar los que llegan como root
  (Coolify, Railway, bind mounts) antes de bajar a `vocero`; sin eso el
  guardado fallaba con EACCES.
- Suscribir `smb_message_echoes` en la app de Meta (panel → WhatsApp →
  Webhook fields) para recibir los mensajes manuales.

## Verificación

`pnpm typecheck && pnpm lint && pnpm build && pnpm test` +
`node --env-file=.env scripts/e2e-selftest.mjs` (secciones 008: echoes,
envío de adjuntos, previews — felices e infelices). Probado además en
producción en una instancia derivada con coexistence real (echo desde el
teléfono, foto real ingerida y servida desde el volumen).
