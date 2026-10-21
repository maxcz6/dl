# Implementation Plan: El secreto de firma de Zernio, cifrado en reposo

**Branch**: `feat/030-secreto-zernio-cifrado` | **Spec**: [spec.md](spec.md)

## Summary

Tres columnas cifradas por tabla de credenciales de canal; una sola puerta que
convierte el secreto en columnas (cifra y deja la vieja en nulo) y otra que lo
lee (cifrado primero, en claro de respaldo); un paso de arranque que cifra lo
que ya estaba guardado.

## Technical Context

- **Stack**: el del repo. Sin dependencias nuevas.
- **Rendimiento**: el webhook no gana consultas. Leer credenciales descifra un
  valor más en memoria. El arranque gana tres `SELECT` con `IS NOT NULL`.
- **Dónde corre la migración de datos**: `register()` de
  `src/instrumentation.ts` → `instrumentation-node.ts`, después de que
  `migrate.mjs` dejó las columnas (en el contenedor, `node migrate.mjs && node
  server.js`; en desarrollo, `pnpm db:migrate` antes de `next dev`). Razones en
  la spec, D3.

## Modelo de datos

En `instagram_credentials`, `messenger_credentials` y `tiktok_credentials`:

| Columna | Tipo | Qué |
|---|---|---|
| `webhook_secret_cipher` | text NULL | secreto HMAC de Zernio, cifrado (base64) |
| `webhook_secret_iv` | text NULL | iv de 12 bytes (base64) |
| `webhook_secret_tag` | text NULL | tag de GCM (base64) |
| `webhook_secret` | text NULL | **obsoleta**: solo la lee el respaldo de D5 y la vacía el arranque; se quita en una versión mayor (D6) |

Las tres nuevas van juntas: o las tres tienen valor o las tres son nulas. Sin
índices: se leen por la fila.

Migración `0020_secreto_zernio_cifrado`: nueve `ALTER TABLE … ADD COLUMN`.
Aditiva; una instalación anterior la aplica al arrancar el contenedor.

## Diseño

1. `src/server/zernio/secreto-guardado.ts` (nuevo):
   - `columnasDelSecreto(secret | null)` → `{ webhookSecret: null,
     webhookSecretCipher, webhookSecretIv, webhookSecretTag }` (las tres nulas
     si no hay secreto). Es lo único que escribe esas columnas.
   - `secretoDeLaFila(row)` → el descifrado si hay cifrado; si no, la columna
     vieja (D5); si no, `null`.
   - `cifrarSecretosEnClaro()` → por cada tabla, `SELECT id, webhook_secret
     WHERE webhook_secret IS NOT NULL`, y por cada fila `UPDATE … SET
     columnasDelSecreto(valor) WHERE id = $id AND webhook_secret = $valor`.
     Devuelve cuántas cifró. Nunca lanza: lo atrapa quien llama.
2. `instagram/credentials.ts`, `messenger/credentials.ts`,
   `tiktok/credentials.ts`: `toCredentials` usa `secretoDeLaFila`; el
   `save*Credentials` usa `columnasDelSecreto(input.webhookSecret)`.
3. `zernio/conexiones.ts`: `update` traduce `webhookSecret` con
   `columnasDelSecreto` antes del `set`. `byOrg`, `byAccountRef` y
   `storedZernioSecrets` ya leen por las credenciales del canal (punto 2): no
   cambian de forma. `ensureWebhookForOrg` sigue comparando secretos
   descifrados.
4. `instrumentation-node.ts`: `encryptLegacySecrets()` (envoltorio con
   try/catch y el log `[boot] N secreto(s) de firma de Zernio cifrado(s) en
   reposo`); `instrumentation.ts` lo espera después de `cleanupOrphanRuns`.

## Project Structure

```text
src/lib/db/schema.ts                               3 columnas × 3 tablas; webhook_secret obsoleta
drizzle/0020_secreto_zernio_cifrado.sql            migración (+ snapshot y journal)
src/server/zernio/secreto-guardado.ts              columnasDelSecreto, secretoDeLaFila, cifrarSecretosEnClaro
src/server/{instagram,messenger,tiktok}/credentials.ts
src/server/zernio/conexiones.ts                    update cifra
src/instrumentation.ts, src/instrumentation-node.ts
tests/unit/secreto-zernio.test.ts                  guardado sin claro, lectura, arranque
scripts/e2e-canales.mjs, tests/e2e/us-canales.md   la base no guarda el secreto en claro
AGENTS.md, CHANGELOG.md, specs/README.md, docs/bitacora-2.0.md
```

## Verificación

- Los cuatro gates (banderas apagadas y `CHANNELS` + `AGENDA`).
- `e2e-canales`, `e2e-messenger`, `e2e-tiktok`, `e2e-despacho` (con cerebro y
  con el agente incluido).
- **Actualización**: una base nueva migrada hasta `0019` con el código de
  `main`, conexiones guardadas por ese código (secreto en claro); después,
  esta rama: `0020`, arranque, filas cifradas con la vieja en nulo, una
  entrega firmada con el secreto de antes → 200, segundo arranque sin log.
- **Prueba en vivo**: el canal tocado son los webhooks de Zernio. En local no
  hay DM real sin mover el webhook de Zernio de Kevin, que hoy apunta a
  `vocero-clase`; en Coolify, la instancia `vocero-clase`. Las dos cosas
  esperan a que Kevin lo pida (instrucción de esta tarea). Receta cuando lo
  autorice: desplegar la imagen con esta rama en `vocero-clase`, ver en el log
  del arranque cuántos secretos cifró, y un DM real de `kevin.belier` a
  Instagram que entra con la firma verificada y recibe respuesta.
