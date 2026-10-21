# Implementation Plan: De qué anuncio llegó cada conversación

**Branch**: `feat/anuncio-de-origen` | **Spec**: [spec.md](spec.md) | **Datos**: [data-model.md](data-model.md)

## Summary

El `referral` de WhatsApp se normaliza a un «anuncio de origen» y se guarda en
`ad_attribution` siempre; el `ctwa_clid` solo con `ATRIBUCION`. La imagen del
creativo se copia en segundo plano a un `media_asset` por anuncio. La bandeja lo
enseña en la lista, el panel y el cajón del trato. Es un puerto de la spec 212 de
Vocero Cloud sin edición, cuotas, organizaciones múltiples ni Instagram.

## Technical Context

- **Stack**: Next.js 15, TypeScript estricto, Drizzle + PostgreSQL, Vitest,
  arnés `scripts/e2e-selftest.mjs`, Playwright.
- **Dependencias nuevas**: ninguna.
- **Almacenamiento**: la imagen por `saveMediaFile` en `MEDIA_DIR`, como los
  adjuntos de 008.
- **Rendimiento**: la lista suma un `LEFT JOIN` por la llave única
  (organización, conversación). La copia de la imagen no está en el camino del
  webhook.
- **Restricciones**: sin llamadas nuevas a terceros más allá de leer la imagen que
  Meta ya enlaza en su propio CDN.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | El `ctwa_clid` no sale por ninguna API. La imagen se sirve por `/api/media` con sesión. La descarga solo acepta https a hosts de Meta, revalida cada salto de redirección, sin credenciales en la URL ni puertos raros, tipo y tamaño acotados (el cuerpo se lee con tope, no entero). |
| II · Soberanía | Sin dependencia ni credencial nueva: el `referral` llega en el webhook de WhatsApp Cloud API y la imagen está en el CDN de Meta. La descarga es best-effort: si falla, la tarjeta sale sin imagen. |
| III · Multi-tenancy | Toda lectura por `scoped()` o por la llave (organización, conversación); la imagen se guarda bajo la organización de la fila. |
| IV · Idempotencia | UNIQUE (organización, conversación) con `ON CONFLICT DO NOTHING`; migración re-ejecutable; dos descargas del mismo anuncio no dejan dos adjuntos. |
| Módulos opcionales (016) | Se **enmienda** una decisión de 016 por decisión del dueño: la captura del origen deja de estar tras `ATRIBUCION` (D1); el `ctwa_clid`, la CAPI y la pestaña siguen tras ella (D2). La superficie apagada sigue en 404. |
| Sandbox | Las conversaciones del Laboratorio no llegan por el webhook: no capturan anuncio. |
| V · Hecho | Unitarias de normalización, URL permitida, descarga, bandera y freno de reparación; arnés E2E con la bandera apagada y encendida; guion de navegador. |

Sin violaciones. Se repite tras el diseño: la imagen como `media_asset` sin
mensaje no cambia la ruta que la sirve (`ensureAssetAvailable` no toca un asset
`available`, y uno sin `wa_media_id` no intenta Graph).

## Project Structure

```text
src/lib/db/schema.ts                     ad_attribution.image_asset_id + índice
drizzle/0014_anuncio_de_origen.sql       migración re-ejecutable (+ snapshot y journal)
src/server/attribution/referral.ts       normalización pura del referral de WhatsApp
src/server/attribution/creativo.ts       URL permitida y copia de la imagen
src/server/attribution/store.ts          registrar, leer, reparar y serializar
src/server/attribution/flag.ts           comentarios: qué apaga la bandera ahora
src/server/whatsapp/media.ts             deleteMediaFile
src/server/inbox/ingest.ts               captura siempre, sin romper la ingesta
src/server/inbox/queries.ts              anuncio en la lista y el detalle
src/server/contact-source.ts, contacts.ts fuente deducida
src/app/api/contacts/[id]/route.ts       anuncio del contacto + reparación
src/app/api/conversations/[id]/route.ts  el evento SSE lleva el anuncio
src/lib/types.ts, src/lib/anuncios.ts    DTOs y etiquetas
src/components/anuncio-origen.tsx        la tarjeta
src/components/inbox/, pipeline/         marca, filtro y tarjeta
src/server/dev/, src/app/api/dev/wa-mock/ referral libre en el inbound y creativos de prueba
scripts/e2e-selftest.mjs                 sección 018 y ajuste de la 016 apagada
scripts/e2e-anuncio-origen-ui.mjs        guion de navegador y capturas
tests/unit/anuncio-origen.test.ts        unitarias
```

## Diseño

- **Captura**: `processMessagesValue` normaliza con `anuncioDeWhatsapp` y se lo
  pasa a `ingestInboundMessage`, que lo registra tras resolver contacto y
  conversación y **antes** del dedup del mensaje (como 016), dentro de un
  `try/catch`. Sin `ATRIBUCION`, `ctwaClid` va nulo y `raw` sin la clave.
- **Imagen**: si la fila es nueva y trae `source_id` e imagen, se lanza
  `guardarCreativo` sin esperar. Primero reutiliza la imagen de otra fila del
  mismo anuncio; si no, descarga (una por proceso a la vez por anuncio), guarda
  el archivo, la asigna a todas las filas del anuncio sin imagen y, si otra
  descarga ganó, borra la suya. Publica `conversation.updated` para que la
  tarjeta abierta se refresque sola.
- **Reparación**: `GET /api/contacts/[id]` con anuncio sin imagen dispara
  `repararImagenSiFalta` en segundo plano, con freno de 10 minutos por anuncio.
  Lee la URL del `raw`, así que sirve también para filas de 016.
- **Mocks**: el inbound del wa-mock acepta un `referral` libre; la ruta
  `media-file` sirve PNG reales para ids `creativo-*` y provoca a propósito los
  caminos a rechazar (enorme, SVG, redirección, lento, falla). Con los mocks
  habilitados se permite el origen de `META_GRAPH_BASE_URL` (nunca en
  producción: `isMockEnabled` exige `NODE_ENV !== "production"`).

## Migración, rollout y reversión

- `0014_anuncio_de_origen`: generada con `pnpm db:generate` (su `when` es mayor
  que el de `0013`) y editada a mano para ser re-ejecutable. Se verifica desde
  base vacía y sobre una base en `0013` con datos.
- **Rollout**: sin variables nuevas. Una instancia con `ATRIBUCION` apagada
  empieza a guardar el origen (sin `ctwa_clid`) desde el despliegue.
- **Reversión**: la app anterior ignora la columna; no hace falta borrarla.

## Verificación

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
2. Migración desde base vacía y desde `0013` con datos, en Postgres embebido.
3. `pnpm test:e2e` con `ATRIBUCION` apagada y encendida.
4. `scripts/e2e-anuncio-origen-ui.mjs`: lista, filtro, panel, cajón, claro y
   oscuro, 1440 y 390 px.
