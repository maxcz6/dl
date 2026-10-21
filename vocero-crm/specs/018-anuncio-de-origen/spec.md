# Feature Specification: De qué anuncio llegó cada conversación

**Feature Branch**: `feat/anuncio-de-origen`, sobre la rama de #64
(`feat/panel-bicolor-logo-interruptor`), que toca los mismos componentes de la
bandeja.

**Created**: 2026-09-21

**Status**: Especificada antes de escribir código.

**Input**: decisión del dueño el 2026-09-21: traer al raíz la pieza visible de
la spec 212 de Vocero Cloud («de qué anuncio llegó cada conversación») sin nada
de su código multitenant, con el origen del anuncio **siempre visible**.

**Carril**: ciclo completo (Principio VI). Añade una columna y un índice
(migración `0014`) y un campo aditivo a los DTOs de `/api/conversations`,
`/api/contacts/[id]` y del evento SSE `conversation.updated`.

## Contexto

Meta dice de qué anuncio Click-to-WhatsApp (CTWA) vino una persona en el
**primer** mensaje de la conversación (objeto `referral`), y no lo vuelve a
decir. La spec 016 lo captura hoy solo con la bandera `ATRIBUCION` encendida, y
solo para reportar conversiones: en pantalla aparece únicamente en Ajustes →
Anuncios, como actividad de la Conversions API. Dejó fuera a propósito «la
miniatura del creativo y la ficha de de qué anuncio vino», guardando el `raw`
para que alguien la pintara sin migrar nada.

Vocero Cloud la pintó en su spec 212 (bandeja, panel y cajón del trato). Esta
spec la trae al raíz con la estructura de la tabla de 016, para que los dos
repos sigan compartiendo `ad_attribution`.

## Decisiones del dueño (2026-09-21)

- **D1 — El origen se ve siempre**, con `ATRIBUCION` encendida o apagada.
  Capturar el `referral` es pasivo: viaja dentro del webhook que la instancia ya
  recibe, no pide credenciales, no llama a nadie y es inerte si nunca llega un
  anuncio. Decir de dónde llegó un cliente es parte de atenderlo.
- **D2 — Lo de Meta sigue detrás de la bandera**: el `ctwa_clid`, la Conversions
  API y la pestaña Ajustes → Anuncios. Con la bandera apagada el `ctwa_clid` **no
  se guarda**, ni en su columna ni dentro del `raw`, y la tarjeta no dice «Meta
  identificó el clic». Se conserva así la promesa de 016: una instancia que no
  atribuye no acumula identificadores de clic «por si acaso».
- **D3 — Solo WhatsApp** por ahora. Instagram y Messenger mandan otra forma de
  `referral` (`ad_id`, `ads_context_data`); quedan para después.
- **D4 — La imagen va al volumen de adjuntos** como un `media_asset`, una vez
  por anuncio, servida por `/api/media/[assetId]` con sesión. No un data URI por
  conversación en la base.
- **D5 — Solo hosts de Meta.** La URL de la imagen llega en un payload externo:
  descargar cualquier URL convertiría la ingesta en un proxy hacia la red
  interna (SSRF).

## Alcance

**Entra**:

- Captura del anuncio de origen de WhatsApp (Meta Cloud API), siempre.
- Imagen del creativo copiada una sola vez por anuncio al volumen de adjuntos,
  con reintento y reparación.
- Bandeja: marca «Anuncio · titular» en la lista y filtro «Anuncios».
- Tarjeta del anuncio en el panel del contacto y en el cajón del trato.
- La fuente de un contacto sin fuente capturada se deduce «Anuncio».

**Fuera de alcance a propósito**:

| Qué | Por qué no |
|---|---|
| Nombre del anuncio, campaña o conjunto | Meta no los manda en el `referral`; exigirían la API de Marketing con permisos de anuncios del negocio (Principio II). |
| Instagram y Messenger | D3. |
| Tabla «Por anuncio» y gasto | El raíz no tiene pantalla de Resultados. |
| Script de backfill de imágenes viejas | Las filas de 016 ya guardan la URL en `raw`: la reparación al abrir el contacto las cubre mientras Meta no la caduque. |
| Contar un segundo anuncio en la misma conversación | Gana el primero, como en 016. |
| Dar el anuncio a un cerebro externo (`/api/bot/*`) | Cambia un contrato publicado; cuando un cerebro lo vaya a usar. |

## User Scenarios & Testing

### User Story 1 — Guardar de qué anuncio llegó (Priority: P1)

Cuando alguien escribe desde un anuncio, la conversación queda con su anuncio de
origen, con la bandera encendida o apagada.

**Independent Test**: un inbound del wa-mock con `referral`, con `ATRIBUCION`
apagada y encendida, y leer el anuncio por la API.

**Acceptance Scenarios**:

1. **Given** un primer mensaje con `referral` (`source_id`, `headline`, `body`,
   `source_url`, `image_url`, `ctwa_clid`), **When** se ingiere, **Then** la
   lista y el detalle del contacto traen el anuncio.
2. **Given** `ATRIBUCION` apagada, **When** llega ese mensaje, **Then** el
   anuncio se guarda **sin** `ctwa_clid` (columna nula y `raw` sin la clave) y el
   detalle dice `hasCtwaClid: false`.
3. **Given** `ATRIBUCION` encendida, **When** llega, **Then** se guarda el
   `ctwa_clid` y el detalle dice `hasCtwaClid: true`, sin el valor.
4. **Given** la misma entrega repetida, o un mensaje posterior con otro anuncio,
   **When** se procesa, **Then** el anuncio original sigue y el mensaje no se
   duplica.
5. **Given** un `referral` sin ninguno de `source_id`, `ctwa_clid`, `headline`
   o `source_url`, **When** se ingiere, **Then** no hay anuncio y el mensaje
   entra.

### User Story 2 — Verlo en la bandeja y en el pipeline (Priority: P1)

**Independent Test**: una conversación de anuncio y otra orgánica, en el
navegador: lista, filtro, panel y cajón del trato.

**Acceptance Scenarios**:

1. **Given** una conversación de anuncio, **When** se ve la lista, **Then** su
   renglón dice «Anuncio · titular» («Publicación» si Meta marcó `post`).
2. **Given** al menos una conversación de anuncio, **When** se ve la lista,
   **Then** hay un filtro «Anuncios» con su contador que deja solo esas; sin
   ninguna, el filtro no aparece.
3. **Given** esa conversación abierta, **When** se mira el panel, **Then** hay una
   tarjeta con la imagen del creativo, titular, texto, «Primer mensaje · fecha»,
   «con video» si aplica, «ID <source_id>» y «Ver anuncio» (solo https). La misma
   tarjeta sale en el cajón del trato del pipeline.
4. **Given** `ATRIBUCION` encendida y un clic con `ctwa_clid`, **When** se mira la
   tarjeta, **Then** dice «Meta identificó el clic», y nunca el valor. Apagada, no
   lo dice.
5. **Given** una conversación orgánica, **When** se abre, **Then** no hay tarjeta.

### User Story 3 — La imagen del creativo (Priority: P2)

La URL que manda Meta caduca en días (parámetro `oe=` de su CDN): se copia al
llegar.

**Acceptance Scenarios**:

1. **Given** un anuncio con `thumbnail_url` o `image_url` de Meta, **When** se
   ingiere, **Then** la imagen queda guardada y se sirve con sesión (sin sesión,
   401). Se prefiere `thumbnail_url`.
2. **Given** otra persona del mismo anuncio, **When** llega, **Then** comparte la
   misma imagen: no se descarga otra vez.
3. **Given** una URL fuera de Meta, una redirección a otro host, un SVG o una
   imagen de más de 300 KB, **When** llega, **Then** la tarjeta aparece sin imagen
   y el mensaje entra igual.
4. **Given** una descarga que tropieza una vez (tiempo, red, 5xx, 429), **When**
   se reintenta, **Then** la imagen llega.
5. **Given** una descarga que falló dos veces, **When** se abre el contacto,
   **Then** se repara en segundo plano, como mucho una vez cada 10 minutos por
   anuncio. Cubre también las filas guardadas por 016 antes de esta spec.

### Edge Cases

- Dos descargas simultáneas del mismo anuncio no dejan un adjunto de más.
- Payload con cadenas gigantes o tipos equivocados: se recorta o se ignora.
- La copia de la imagen jamás retrasa ni rompe la ingesta del mensaje.
- Filas guardadas con la bandera encendida y apagada después: la tarjeta deja de
  decir «Meta identificó el clic».

## Requirements

### Functional Requirements

- **FR-001**: La ingesta MUST normalizar `messages[].referral` a un anuncio de
  origen y guardarlo con la conversación, independientemente de `ATRIBUCION`.
- **FR-002**: Con `ATRIBUCION` apagada MUST NOT guardarse el `ctwa_clid`, ni en
  su columna ni en `raw`.
- **FR-003**: El primer anuncio de una conversación MUST ganar
  (`ON CONFLICT DO NOTHING` sobre organización y conversación).
- **FR-004**: El `raw` MUST guardarse acotado (claves conocidas, cadenas
  recortadas, 8 KB máximo).
- **FR-005**: Un fallo al guardar el anuncio MUST NOT impedir ingerir el mensaje.
- **FR-006**: La imagen MUST descargarse fuera del camino del webhook, solo por
  https desde hosts de Meta (con los mocks habilitados, también el origen del
  wa-mock), validando cada redirección (máximo 3), JPEG/PNG/WebP/GIF, hasta
  300 KB, 5 s por intento y un reintento ante fallo transitorio.
- **FR-007**: Si la imagen falta, abrir el contacto MUST reintentarla en segundo
  plano, como mucho una vez cada 10 minutos por anuncio.
- **FR-008**: La lista de conversaciones MUST traer el anuncio (titular, id y
  tipo); el detalle del contacto, el anuncio completo sin el valor del
  `ctwa_clid`, y `hasCtwaClid` solo verdadero con la bandera encendida.
- **FR-009**: La fuente de un contacto sin fuente capturada MUST deducirse
  «anuncio» cuando llegó de un anuncio (no de una publicación).
- **FR-010**: Ajustes → Anuncios, `/api/settings/capi*` y el envío a Meta MUST
  seguir sin existir con la bandera apagada.

### Key Entities

- **Anuncio de origen** (`ad_attribution`, de 016): uno por conversación, más
  `image_asset_id`.
- **Imagen del creativo**: un `media_asset` compartido por todos los anuncios de
  origen con el mismo `source_id`.

## Success Criteria

- **SC-001**: Con la bandera apagada y encendida, el arnés E2E muestra el anuncio
  en la lista y en el detalle, con `hasCtwaClid` según la bandera.
- **SC-002**: Reentregas y mensajes posteriores dejan un solo anuncio por
  conversación.
- **SC-003**: Las cuatro URLs hostiles quedan sin imagen y sin romper la ingesta;
  la lenta y la que falla terminan con imagen.
- **SC-004**: Gate técnico y `pnpm test:e2e` en verde; la tarjeta se ve en un
  navegador en claro y oscuro, a 1440 y 390 px.
- **SC-005** (pendiente de verificación humana): un clic real en un anuncio CTWA
  hacia un número conectado muestra el anuncio en la bandeja.
