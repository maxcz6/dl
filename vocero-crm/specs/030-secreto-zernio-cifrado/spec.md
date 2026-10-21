# Feature Specification: El secreto de firma de Zernio, cifrado en reposo

**Feature Branch**: `feat/030-secreto-zernio-cifrado`

**Created**: 2026-10-14

**Status**: Especificada antes de escribir código. Implementada; gates y
guiones E2E en verde. Probada en vivo con la imagen `1.6.0-rc.8` (bitácora).

**Input**: hallazgo de la 023 (2026-10-13), anotado en
`docs/bitacora-2.0.md`: la columna `webhook_secret` de
`instagram_credentials`, `messenger_credentials` y `tiktok_credentials` guarda
en claro el secreto con el que se verifica la firma HMAC de los webhooks de
Zernio. El token de la misma fila sí va cifrado con AES-256-GCM
(`token_cipher`, `token_iv`, `token_tag`, vía `src/lib/crypto`). El Principio I
pide **todo** secreto cifrado en reposo.

**Carril**: ciclo completo (Principio VI). Añade columnas a tres tablas
(migración aditiva `0020`) y mueve datos guardados. No cambia ningún contrato
publicado: ni `/api/bot/*`, ni el despacho, ni la forma de los webhooks, ni las
respuestas de Ajustes. Plan en [plan.md](plan.md), tareas en
[tasks.md](tasks.md).

## El problema

Quien lea la base —un respaldo, un volcado para soporte, un acceso de solo
lectura— obtiene el secreto con el que Zernio firma sus entregas. Con él puede
**fabricar eventos que el CRM acepta como de Zernio**: mensajes de Instagram,
Messenger o TikTok que nadie mandó, que entran a la bandeja, crean contactos y
leads, y despiertan al agente o al cerebro, que contesta por la cuenta real del
negocio. La llave de Zernio de la misma fila, que es la que envía, ya está
protegida; el secreto que decide qué se cree, no.

El arreglo no puede ser una migración SQL: cifrar exige `ENCRYPTION_KEY`, que
vive en el entorno de la app, nunca en la base ni en el repo.

## Decisiones

- **D1 — Tres columnas nuevas por tabla**: `webhook_secret_cipher`,
  `webhook_secret_iv` y `webhook_secret_tag`, nulas (el modo Meta de Instagram
  y Messenger no tiene secreto), con el mismo AES-256-GCM y los mismos helpers
  que el token. Un segundo mecanismo de cifrado sería un segundo mecanismo que
  auditar.
- **D2 — Toda escritura cifra y deja la columna vieja en nulo.** Guardar una
  conexión (las tres pantallas y sus API), el secreto que
  `ensureWebhookForOrg` deja en todos los canales y la autocuración de la
  cuenta escriben solo las columnas cifradas. Desde esta versión, nada escribe
  `webhook_secret`.
- **D3 — Lo ya guardado se cifra al arrancar la app, no en SQL.** Un paso de
  arranque en `instrumentation-node.ts` (donde ya viven la limpieza de corridas
  huérfanas y la reanudación del despacho) recorre las filas que aún tienen
  `webhook_secret`, las cifra con `encryptSecret` y deja la vieja en nulo.
  Evaluado contra hacerlo en `scripts/migrate.mjs`:
  - El migrador corre como proceso aparte, empaquetado sin el alias `@/` y sin
    validar el entorno: tendría que reimplementar el cifrado o cargar el
    `getEnv()` de la app. En el arranque de Next se usa **el mismo**
    `encryptSecret` que escribe el token, con la clave ya validada.
  - El arranque de Next corre igual en el contenedor, con `next start`, con
    `next dev` y en los arneses E2E; el migrador solo en el contenedor
    (`pnpm db:migrate` es `drizzle-kit`). Así no hay una base de desarrollo
    que se quede con secretos en claro.
  - El migrador sale con 1 ante cualquier fallo y el contenedor no arranca.
    Este paso no debe tumbar nada (D5).
- **D4 — Re-ejecutable y sin pisar.** Cada fila se actualiza con la condición
  «`webhook_secret` sigue siendo el que leí». Si entre la lectura y la
  escritura alguien guardó un secreto nuevo (que ya llega cifrado y con la
  vieja en nulo), la actualización no toca nada. Dos réplicas arrancando a la
  vez cifran la misma fila y gana una: las dos escrituras son válidas.
- **D5 — Si el paso falla, el CRM sigue verificando.** La lectura prefiere la
  columna cifrada y, mientras una fila no tenga cifrado, usa la vieja. Así los
  webhooks no fallan en los segundos entre que arranca el servidor y termina
  el paso, ni si el paso no pudo correr (base caída en ese momento). El fallo
  queda en el log (`[boot]`), sin ningún valor. El siguiente arranque o la
  siguiente escritura lo terminan.
- **D6 — La columna vieja se queda, nula, hasta una versión mayor.** Quitarla
  es destructivo: una instalación que saltara directo a la versión que la
  quita perdería su secreto sin haberlo cifrado nunca. Se quita en una versión
  mayor (2.0 o posterior) cuyo «cómo actualizar» diga «pasa antes por 1.6».
  Mientras tanto, el `schema.ts` la marca como obsoleta y nada la escribe.
- **D7 — Nada cambia hacia fuera.** Las credenciales en memoria siguen
  teniendo `webhookSecret: string | null` descifrado; las rutas de Ajustes, la
  verificación de la firma (`isAuthenticZernioDelivery`) y el alta del webhook
  en Zernio no notan la diferencia. El secreto sigue sin salir en ninguna
  respuesta ni log.

## Alcance

**Entra**:

- Columnas `webhook_secret_{cipher,iv,tag}` en las tres tablas y migración
  `0020`.
- `src/server/{instagram,messenger,tiktok}/credentials.ts`: guardar cifrado,
  leer con D5.
- `src/server/zernio/conexiones.ts`: `update` cifra (es la escritura de
  `ensureWebhookForOrg` y de `healZernioAccountRef`); `byOrg`, `byAccountRef`
  y `storedZernioSecrets` leen a través de las credenciales del canal.
- El paso de arranque (D3, D4) y su aviso en el log.
- Unitarias: la fila guardada no contiene el secreto en claro (como
  `tests/unit/credentials.test.ts` con el token), lectura con y sin cifrado,
  el paso de arranque.
- `scripts/e2e-canales.mjs`: comprueba en la base que ninguna fila guarda el
  secreto en claro tras conectar los tres canales.

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| Quitar `webhook_secret` | D6: destructivo; va en una versión mayor. |
| Cifrar con otra clave o rotar `ENCRYPTION_KEY` | Es otra feature; aquí se usa la misma clave que el token. |
| La caché de secretos leídos de Zernio (`webhookSecretsFromZernio`) | Vive en memoria del proceso, no en reposo. |
| Otros secretos de la base | Los demás (`token_*`, `secret_*` de Zoom, `client_secret_*` y `refresh_token_*` de Google, la llave de IA) ya van cifrados. |
| Cambiar la UI | No hay nada que ver: el secreto ya no se enseñaba. |

## Comportamiento observable

### Historia 1 — Conectar un canal por Zernio (P1)

- **AC1** Al conectar Instagram, Messenger o TikTok por Zernio (con o sin
  secreto propio), ninguna columna de la fila guarda el secreto en claro: hay
  cifrado, iv y tag, y `webhook_secret` es nulo.
- **AC2** Una entrega firmada con ese secreto da 200; una con un secreto que no
  es de nadie, 401 (los casos de la 023 siguen igual).
- **AC3** El secreto que el CRM genera o reutiliza al dar de alta el webhook
  queda cifrado en los tres canales, y es el mismo que tiene Zernio.

### Historia 2 — Actualizar una instalación con secretos en claro (P1)

- **AC4** Una base en `0019` con conexiones guardadas por la versión anterior
  (secreto en claro) actualiza redesplegando: la migración `0020` solo añade
  columnas nulas, y al arrancar la app cada secreto queda cifrado y su columna
  vieja en nulo. El log dice cuántos, nunca cuáles.
- **AC5** Tras actualizar, una entrega firmada con el secreto de antes sigue
  dando 200: la instalación no tiene que reconectar nada.
- **AC6** Arrancar otra vez no cambia nada y no escribe en el log.
- **AC7** Una fila en claro que el paso aún no cifró (o que no pudo cifrar)
  sigue verificando la firma.

### Historia 3 — Lo demás no cambia (P1)

- **AC8** `e2e-canales`, `e2e-messenger`, `e2e-tiktok` y `e2e-despacho` (en
  sus dos modos) en verde sin cambiar lo que comprueban.
- **AC9** Ninguna respuesta de la API ni línea del log contiene el secreto.

## Requisitos no funcionales

- El paso de arranque es una lectura por tabla con `webhook_secret IS NOT
  NULL`: sin filas en claro, tres consultas que no devuelven nada.
- Leer las credenciales descifra a lo sumo un valor más por fila, en memoria,
  como ya pasa con el token.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | Es el motivo de la spec: el último secreto de la base que iba en claro pasa a AES-256-GCM con la clave del entorno. Ningún valor en logs ni respuestas; el log del arranque solo cuenta filas. |
| II · Soberanía | Sin dependencias nuevas. El cifrado es el de `node:crypto` que ya se usa. |
| III · Multi-tenancy | Las columnas viven en filas que ya llevan `organization_id`; el paso de arranque recorre las tres tablas de la instancia y actualiza cada fila por su `id`, sin cruzar datos entre organizaciones (solo reescribe el mismo valor cifrado). |
| IV · Idempotencia | Migración aditiva y re-ejecutable; el paso de arranque solo toca filas con `webhook_secret` no nulo y con escritura condicionada (D4). |
| V · Hecho | Unitarias de guardado, lectura y paso de arranque; los cuatro guiones E2E; la actualización probada sobre una base en `0019` con datos escritos por el código de `main`. |
| VI · Specs | Ciclo completo: migración y datos movidos. Spec, plan y tareas antes del código. |
| VIII · Foco | Endurece el núcleo de canales; no añade superficie. |
| IX · En vivo | Ver «Prueba en vivo» en el plan: la parte en Coolify espera autorización de Kevin para tocar `vocero-clase`. |
| Contratos públicos | Ninguno cambia (D7). |
| Sandbox | Sin relación: no hay envíos nuevos. |

Sin violaciones.
