# Plan — 037 Almacenamiento

1. `src/lib/storage/objetos.ts` (puerto tal cual de cloud) y
   `src/lib/storage/medios.ts`: el adaptador con D3 y D4.
2. `src/lib/env.ts`: `MEDIA_STORE` y `MEDIA_BUCKET_*`.
3. `src/server/whatsapp/media.ts`: `saveMediaFile`, `readMediaFile` y
   `deleteMediaFile` delegan en el adaptador; `contentType` opcional. Los
   llamadores (`send.ts`, `creativo.ts`) pasan el mime. El favicon usa
   `deleteMediaFile`.
4. `src/server/media-dir.ts` → sondeo del almacén activo; `/api/health`
   (`features.media`), el arranque y `pnpm doctor`.
5. Pruebas unitarias del adaptador (puerto de `medios-almacenamiento.test.ts`
   de cloud, más la degradación de D4).
6. `scripts/e2e-almacenamiento.mjs` contra un MinIO local (docker).
7. Compose: servicio `minio` + creador del bucket, perfil `bucket`.
   `.env.example`, README, AGENTS, INSTALL-IA, CHANGELOG; comentarios de
   Render, Fly y Railway.
8. En vivo: MinIO dentro de `vocero20-par`, imagen real por WhatsApp.
