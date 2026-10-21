# 035 — Contrato público y guía de migración a 2.0

**Feature Branch**: `feat/035-contrato-y-migracion`

**Created**: 2026-10-20

**Status**: Especificada antes de escribir código.

**Input**: cuarta pieza de la 2.0.0 (`PLAN-2.0.md`): kevinrivm/vocero-crm#92.
Kevin autorizó en el chat del 2026-10-20 mergear la 034 y seguir con la #92.

**Carril**: ciclo completo (Principio VI). Publica el contrato del par y
cambia cómo se instala (el compose levanta dos servicios). Plan en
[plan.md](plan.md), tareas en [tasks.md](tasks.md).

## Problema

Con el agente fuera del CRM, el contrato es lo único que une a Vocero con Nea
o con cualquier otro cerebro. Hoy vive en docstrings de rutas, en el README y
en `specs/021-despacho-estandar/contracts/despacho.md`. Y quien actualiza no
tiene una guía: depende de dónde viene. Además, quien tenía Nea 1.x delante
del CRM tiene el webhook de Meta en un override que el CRM respeta y no puede
recuperar desde la interfaz.

## Historias

**H1 — Quien escribe un cerebro tiene el contrato en un archivo.** Un OpenAPI
de `/api/bot/*` y del despacho, en el repo y servido por la instancia.

**H2 — El contrato no se rompe sin que una prueba lo diga.** El OpenAPI se
valida contra las rutas en `pnpm test`.

**H3 — Quien venía con Nea 1.x recupera el webhook desde Ajustes → WhatsApp.**

**H4 — Instalar el par es un solo `docker compose up`.**

**H5 — Quien actualiza sabe qué hacer**, según de dónde viene.

## Decisiones

**D1 — `docs/openapi.json`, OpenAPI 3.1, escrito a mano y versionado.** Las
diez rutas de `/api/bot/*` en `paths`, y el despacho y el aviso de olvido en
`webhooks` (lo que el CRM le manda al cerebro), con sus cabeceras, la firma y
qué respuestas se reintentan. Se sirve en `GET /api/bot/openapi.json`, sin
llave: es documentación, no lleva secretos.

**D2 — Se valida en `pnpm test`** (`tests/unit/openapi.test.ts`): cada ruta de
`src/app/api/bot/**/route.ts` está en el OpenAPI con sus métodos, y al revés;
los ejemplos del despacho y del olvido son los cuerpos gemelos fijados byte a
byte en `despacho-contrato.test.ts` y `olvido-contrato.test.ts`; el perfil
declara `role` y `tools`; los 409 de `/api/bot/messages` son los que la ruta
devuelve.

**D3 — Pruebas gemelas: ya existen** (despacho y olvido, en los dos repos). El
OpenAPI apunta a ellas; no se duplican.

**D4 — Regla de versión del contrato**, escrita en el OpenAPI y en la guía:
agregar una llave cabe; quitar o renombrar, no (eso es una versión mayor).
Lo que 2.0 añadió queda listado como cambio de contrato: `adOrigen`,
`fileName`/`location`/`contacts`, `conversation.test`, `role` y `tools`, y
`/api/bot/messages` guardando las respuestas de prueba.

**D5 — «Recuperar el webhook» en Ajustes → WhatsApp.** Cuando el registro se
saltó por un override ajeno en la WABA (`skipped: "waba_override"`), la
tarjeta del webhook ofrece recuperarlo. `POST /api/settings/webhook` con
`{"recuperar": true}` **quita el override ajeno de la WABA** (re-suscribe la
app sin cuerpo, que es como Meta lo borra) y registra el del número hacia el
CRM. Solo quien administra; la pantalla dice antes quién deja de recibir.
*Decidido al implementar:* la primera versión dejaba el de la WABA intacto,
y el e2e mostró que el siguiente «Guardar» lo veía y quitaba el del número
recién recuperado (la regla que protege a una agencia). Quitar el de la WABA
es lo que hace que la recuperación dure.

**D6 — El compose levanta el par.** `docker-compose.yml` suma el servicio
`nea` (`ghcr.io/kevinrivm/nea-agent:${NEA_VERSION:-2.0.0}`) sobre la **misma
base**, en su esquema `nea`. El CRM despacha a `http://nea:8000` por defecto y
le lee el `/health`. Nea pide su llave de IA (`LLM_API_KEY`) hasta que la #106
la mueva al CRM. *Decidido al implementar:* mientras la imagen de Nea 2.0.0
no esté publicada, el servicio va detrás del perfil `nea`
(`docker compose --profile nea up -d`) y el bloque de Render va comentado:
con la imagen por defecto, un `git pull && docker compose up` desde `main`
antes del cierre fallaría. En el cierre de la 2.0 se quita el perfil. `render.yaml` gana el segundo servicio; en Fly y Railway, que
despliegan una app por manifiesto, los comentarios dicen cómo levantar a Nea
al lado.

**D7 — La guía**: `docs/migrar-a-2.0.md`, con los tres casos del issue (solo
el agente incluido, Nea 1.x delante, cerebro propio), los pasos con «Recuperar
el webhook», y lo que se quitó de Nea. El README y `INSTALL-IA.md` dejan de
decir «mueve el webhook a Nea» y enlazan al OpenAPI y a la guía.

**D8 — Fuera**: el starter (`vocero-starter-v2`, otro repo) se actualiza en
el cierre de la 2.0 (starter 3.0.0); el retiro del agente incluido es la #106.

## Criterios de aceptación

- **AC1** — `GET /api/bot/openapi.json` sirve el documento, válido como JSON y
  con `openapi: 3.1.x`.
- **AC2** — `openapi.test.ts`: rutas y métodos en las dos direcciones; los
  ejemplos son los cuerpos gemelos; borrar una ruta o cambiar el cuerpo gemelo
  pone la prueba en rojo.
- **AC3** — «Recuperar el webhook»: con un override ajeno en la WABA (wa-mock),
  el registro normal se salta; recuperarlo quita el de la WABA y deja el del
  número hacia el CRM; un «Guardar» posterior no lo deshace; un miembro del
  equipo recibe 403.
- **AC4** — `docker compose --profile nea config` válido con los dos
  servicios (Nea con `DATABASE_SCHEMA=nea` sobre la misma base y
  `CRM_BASE_URL=http://app:3000`), y sin el perfil, el compose de siempre.
- **AC5** — Gates verdes; `manifests-plataformas` en verde.
- **AC6** — En vivo: `vocero20` sirve el OpenAPI; y «Recuperar el webhook» en
  una prueba con el número «Soporte», devolviendo el override al terminar.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | El OpenAPI no lleva secretos; recuperar el webhook exige rol de configuración y usa el token cifrado del negocio |
| II Soberanía | El compose agrega Nea, que es MIT y self-hosted; ningún tercero |
| VI Spec antes de código | Este documento |
| IX Hecho = probado en vivo | AC6 |
