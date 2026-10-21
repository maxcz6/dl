# Tasks — 018 De qué anuncio llegó cada conversación

## Datos

- [x] T001 `image_asset_id` e índice `ad_attribution_org_source_idx` en `schema.ts`
- [x] T002 `pnpm db:generate` → `0014_anuncio_de_origen`, editada re-ejecutable
- [x] T003 Migrar una base vacía y una base en `0013` con datos

## Servidor

- [x] T004 `referral.ts`: normalización pura del referral de WhatsApp, con cotas
- [x] T005 `creativo.ts`: URL permitida, descarga acotada con reintento, copia única por anuncio
- [x] T006 `deleteMediaFile` en `server/whatsapp/media.ts`
- [x] T007 `store.ts`: registrar (sin `ctwa_clid` con la bandera apagada), leer, reparar con freno, serializar
- [x] T008 Ingesta: captura siempre, antes del dedup, sin romper el mensaje
- [x] T009 `queries.ts` y rutas: anuncio en la lista, el detalle y el evento SSE
- [x] T010 Fuente deducida «anuncio»

## UI

- [x] T011 `lib/anuncios.ts` y `components/anuncio-origen.tsx`
- [x] T012 Marca y filtro «Anuncios» en la lista
- [x] T013 Tarjeta en el panel del contacto y en el cajón del trato

## Mocks, pruebas y documentación

- [x] T014 wa-mock: `referral` libre en el inbound; creativos de prueba en `media-file`
- [x] T015 Unitarias: normalización, URL permitida, descarga, bandera, freno de reparación
- [x] T016 Arnés: sección 018 y la 016 apagada comprueba el origen visible sin clic
- [x] T017 Guion de navegador con capturas
- [x] T018 `flag.ts`, `docs/atribucion-capi.md`, `tests/e2e/us-atribucion.md`, `.env.example`, `CLAUDE.md`
- [x] T019 Gate técnico, `pnpm test:e2e` con la bandera apagada y encendida

## Verificación (2026-09-21, local, Postgres embebido y `next dev`)

- Gate: `typecheck`, `lint`, `test` (54 archivos, 463 pruebas; 29 nuevas en
  `tests/unit/anuncio-origen.test.ts`) y `build`, en verde.
- Migración `0014`: 10/10 comprobaciones desde base vacía y desde una base en
  `0013` con una fila de 016 (intacta, sin imagen; `SET NULL` al borrar el
  adjunto; re-ejecutable dos veces más a mano).
- `pnpm test:e2e` sobre base recién creada: **137/137** con `ATRIBUCION`
  apagada y **152/152** encendida (la sección 018 son 26 comprobaciones en las
  dos; la 016 apagada suma 2).
- `scripts/e2e-anuncio-origen-ui.mjs`: 32/32 apagada y 32/32 encendida, claro y
  oscuro, 1440 y 390 px.
- En la base: con la bandera apagada, 0 filas con `ctwa_clid` en la columna o en
  el `raw`; 4 adjuntos para 5 filas con imagen (la imagen compartida no se
  duplicó).
- Pendiente (SC-005): un clic real en un anuncio CTWA hacia un número conectado.
