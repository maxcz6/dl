# 037 — Almacenamiento: disco por defecto, bucket S3 opcional

**Feature Branch**: `feat/037-almacenamiento`

**Created**: 2026-10-20

**Status**: Especificada antes de escribir código.

**Input**: sexta pieza de la 2.0.0 (`PLAN-2.0.md`): kevinrivm/vocero-crm#93.
Kevin autorizó en el chat del 2026-10-20 mergear la 036 y seguir con la #93.

**Carril**: ciclo completo (Principio VI). Entra un conector opcional
(Principio II.3) con variables nuevas y cambia cómo se guarda cada adjunto.
Plan en [plan.md](plan.md), tareas en [tasks.md](tasks.md).

## Problema

Los adjuntos (entrantes, salientes y la copia del creativo de un anuncio), el
logo y el icono se guardan en el disco del contenedor (`MEDIA_DIR`). En una
plataforma sin disco persistente, o con varias réplicas, cada redeploy los
pierde. Es lo primero que impide correr Vocero fuera de un VPS con volumen.

## Historias

**H1 — Quien instala en un VPS no cambia nada.** El disco sigue siendo el
camino por defecto, sin variables nuevas.

**H2 — Quien quiere un bucket lo enciende con una bandera.** Un S3-compatible
propio (MinIO en su mismo servidor, R2, S3, Backblaze…): los archivos nuevos
van al bucket y los viejos se siguen leyendo del disco.

**H3 — Moverla no rompe nada.** Encender o apagar la bandera no deja ningún
archivo ilegible, sin migrar nada.

**H4 — Si el bucket falla, el dato no se pierde.** Lo dice la salud de la
instancia y `pnpm doctor`.

## Decisiones

**D1 — Puerto de `src/lib/storage/` de la edición cloud** (spec 200 de cloud):
- `objetos.ts`: cliente S3-compatible mínimo, firmado con SigV4 a mano con
  `node:crypto`. Sin SDK de AWS: son tres verbos sin query, y el SDK sería la
  dependencia más pesada del repo.
- `medios.ts`: el adaptador. Habla S3 y el endpoint llega por configuración;
  el dominio no sabe quién guarda los bytes.

**D2 — Bandera y variables** (Principio II.3.1, apagado por defecto):
`MEDIA_STORE=disco|bucket` (por defecto `disco`), `MEDIA_BUCKET_ENDPOINT`,
`MEDIA_BUCKET_NAME`, `MEDIA_BUCKET_REGION` (por defecto `auto`),
`MEDIA_BUCKET_KEY_ID` y `MEDIA_BUCKET_SECRET`. Sin la bandera, la instancia no
las lee ni las menciona. `MEDIA_STORE=bucket` sin las cuatro piezas →
`pnpm doctor` y el arranque lo dicen, y se escribe en disco.

**D3 — Se escribe donde diga la bandera; se lee en los dos sitios.** Primero
donde se escribe hoy y luego en el otro. Así la bandera se mueve en las dos
direcciones sin ventana de corte ni migración. Borrar borra en los dos, como
mejor esfuerzo.

**D4 — Degradación (II.3.3), distinta de cloud.** Cloud lanza si falla el
PUT. Aquí, si el bucket rechaza o no contesta al escribir, **se escribe en
disco y se avisa en el log**: el adjunto de un cliente no se pierde por el
conector. La lectura de D3 lo encuentra después.

**D5 — La API interna no cambia de nombre.** `saveMediaFile`,
`readMediaFile` y `deleteMediaFile` de `src/server/whatsapp/media.ts` delegan
en el adaptador, y `saveMediaFile` gana `contentType` opcional. La ruta
relativa que se guarda en la BD (`{org}/{asset}`) es la llave del objeto: no
hay migración. El favicon deja de borrar con `rm` y usa `deleteMediaFile`.

**D6 — Salud.** `mediaWritable` de `/api/health` y el chequeo de
`pnpm doctor` prueban **donde se escribe**: con bucket, un PUT y un DELETE de
un objeto de sondeo, con la misma caché de 60 s. `/api/health` gana
`features.media: "disco" | "bucket"`. Nunca expone el endpoint ni las llaves.

**D7 — Credenciales (II.3.4).** Son de la instancia, del bucket propio de
quien instala, como `DATABASE_URL`: viven en el entorno, no en la BD, nunca
llegan al cliente ni a un log. No hay una credencial «del negocio» que cifrar
en la BD, porque una instancia es un negocio.

**D8 — Verificable apagado y encendido (II.3.5).**
- Pruebas unitarias del adaptador con `fetch` falso: la firma contra un
  vector fijo, la bandera, la lectura en los dos sitios, la degradación y que
  ninguna llave se filtre.
- Un e2e (`scripts/e2e-almacenamiento.mjs`) contra un MinIO local, con la
  bandera apagada y encendida.

**D9 — Plataformas.** El compose trae un servicio `minio` opcional detrás del
perfil `bucket`, con un contenedor de un solo uso que crea el bucket. Render,
Fly y Railway dicen en sus comentarios cuándo conviene la bandera (sin disco
persistente). Los demás bloqueadores de serverless (el worker del despacho, el
Laboratorio en segundo plano, SSE en memoria, migraciones al arrancar) quedan
fuera, como dice el issue.

## Criterios de aceptación

- **AC1** — Sin la bandera, todo como hoy: gates y e2e de adjuntos verdes; las
  variables nuevas no aparecen en `/api/health`, la guía ni el doctor.
- **AC2** — Con `MEDIA_STORE=bucket` contra MinIO: un adjunto entrante, uno
  saliente y el favicon van al bucket y se sirven. Un archivo escrito antes en
  disco se sigue sirviendo.
- **AC3** — Apagar la bandera después: lo que quedó en el bucket se sigue
  sirviendo.
- **AC4** — Bucket caído al escribir: el adjunto queda en disco y se sirve;
  `mediaWritable` es `false` y el log lo dice.
- **AC5** — La firma SigV4 coincide con un vector conocido; la llave secreta
  no aparece en ninguna respuesta ni log.
- **AC6** — En vivo en `vocero20`: un MinIO dentro del servicio con
  credenciales generadas por Coolify; una imagen real por WhatsApp (de la
  línea cliente, por el relevo) queda en el bucket y se ve en la bandeja.
  Después se devuelve el override.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I Seguridad | Llaves del bucket solo en el entorno; nunca en BD, cliente ni log (D7) |
| II.3 Conector opcional | Apagado por defecto (D2), tras adaptador (D1), con camino sin dependencia y degradación que no pierde el dato (D3, D4), credenciales del propio operador (D7), probado apagado y encendido (D8) |
| IV Idempotencia | La llave del objeto es la ruta que ya está en la BD; escribir dos veces el mismo asset lo sobrescribe |
| VI Spec antes de código | Este documento |
| IX Hecho = probado en vivo | AC6 |

## Decidido al implementar

- **El icono usa siempre la misma llave** (`{org}/favicon`). Leer primero el
  disco servía el icono viejo después de apagar la bandera. Por eso escribir en
  el bucket borra la copia del disco, y escribir en disco con el bucket
  configurado borra la del bucket. El e2e `vuelta` lo cubre.
- **Límite de 15 s por petición al bucket**, para que uno que acepta la
  conexión y no contesta caiga al disco (D4) en vez de colgar el envío.
- **MinIO del compose: `coollabsio/minio`** (la de Coolify, con `mc` adentro):
  las imágenes oficiales `minio/minio` y `minio/mc` dejaron Docker Hub.
- **Límite conocido**: si se cambia el icono con el bucket caído, el nuevo
  queda en disco y el bucket conserva el viejo. Al volver el bucket, se sirve
  el viejo hasta volver a subir el icono. Resolverlo pide llaves versionadas
  del icono; queda fuera de esta spec.
