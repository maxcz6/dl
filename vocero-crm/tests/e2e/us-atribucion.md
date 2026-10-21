# E2E — Atribución de anuncios y Conversions API (016)

Guion de comportamiento observable. Automatizado en la sección `016` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `BOT_API_KEY` y la BD migrada. La bandera
`ATRIBUCION` decide qué mitad del guion corre: **las dos se ejercitan**, porque
una feature opcional que solo se prueba encendida no está probada.

Nada de esto toca Meta. No es comodidad: Meta valida el `ctwa_clid` contra un
clic real y rechaza cualquier valor inventado (`code 100 / error_subcode
2804087`), así que un evento sintético contra la API real es imposible por
diseño. El mock imita las tres cosas que importan: el catálogo cerrado, la
exigencia del clid, y el **200 que descarta el evento**.

---

## US1 — La instancia decide si esto existe

Con `ATRIBUCION` ausente:

1. `GET`/`PUT`/`DELETE /api/settings/capi` y `GET /api/settings/capi/events`
   responden **404** (no 403: aquí ese endpoint no existe).
2. La pantalla `/settings/ads` responde 404 y Ajustes no la menciona.
3. Un mensaje que **sí** viene de un anuncio se atiende como cualquier otro: la
   conversación se crea y el mensaje se ve. Desde 018 **el origen del anuncio se
   ve igual** (titular en la lista), pero se guarda **sin** `ctwa_clid`: el
   detalle dice `hasCtwaClid: false` y el valor no aparece en ninguna respuesta.

Con `ATRIBUCION=on`, las mismas rutas responden con normalidad.

## US2 — Conectar el dataset

1. Sin configurar, `GET /api/settings/capi` responde **200 con `capi: null`**:
   no es un error, es una instancia que aún no conectó.
2. Guardar **sin token** reusa el de la conexión de WhatsApp; el `GET` posterior
   muestra solo los **últimos 4** y el token completo no aparece por ningún lado.
3. Una `qualifiedStageId` que no es de este negocio se rechaza con
   **`422 etapa_invalida`**.
4. Desconectar borra la configuración pero **no** los eventos ya reportados: eso
   ya se le dijo a Meta y sigue siendo cierto.

## US3 — Capturar el anuncio

1. Un inbound con `referral` deja el origen guardado junto a la conversación.
2. Un segundo mensaje del mismo contacto con **otro** `ctwa_clid` no lo
   sobreescribe: **el primer referral gana**, y se comprueba mirando con qué
   clid salió el evento después.

## US4 — El lead calificado

1. Mover el lead a la etapa marcada como calificada reporta `QualifiedLead`, y
   la actividad lo muestra **enviado** con su `fbtrace_id`.
2. El payload que recibió Meta lleva el `ctwa_clid` correcto y
   `custom_data.lead_stage = "qualified"` — sin ese parámetro, ninguna
   conversión personalizada de Meta podría casar jamás.
3. La fila de actividad dice **de qué anuncio** vino (su titular).
4. Sacar el lead de esa etapa y volverlo a meter **no** reporta dos veces.

## US5 — La venta

1. Mover el trato a la etapa ganada con monto reporta `Purchase` con
   `value: 450.5` y su moneda — **unidades, no centavos**.
2. Re-ganar el mismo trato no manda una segunda compra.

## Caminos infelices (los que de verdad importan)

1. **Lead sin anuncio**: la fila queda **omitida** con el motivo escrito
   (`sin ctwa_clid…`) y nada falla.
2. **Meta rechazando** (dataset `-fail`, que responde 200 con
   `events_received: 0`): el lead **se mueve igual** y se queda en su etapa
   nueva; la fila queda **fallida** con lo que dijo Meta. Ninguna conversión
   vale un movimiento de lead bloqueado.

---

## 018 — De qué anuncio llegó cada conversación (siempre visible)

Automatizado en la sección `018` de `scripts/e2e-selftest.mjs` (datos, con la
bandera **apagada y encendida**) y en `scripts/e2e-anuncio-origen-ui.mjs`
(navegador: claro y oscuro, 1440 y 390 px). Los creativos los sirve el wa-mock
(`/api/dev/wa-mock/media-file/creativo-*`), en el origen de
`META_GRAPH_BASE_URL`: el único que la copia acepta fuera de los hosts de Meta,
y solo con los mocks habilitados.

### Captura

1. Un primer mensaje con `referral` deja el anuncio en la lista (titular, id,
   tipo) y en el detalle del contacto (enlace, texto, tipo de medio, fecha).
2. `hasCtwaClid` es `true` solo con la bandera encendida; el valor del
   `ctwa_clid` no aparece en ninguna respuesta, encendida o apagada.
3. Un contacto sin fuente capturada que llegó de un anuncio tiene fuente
   **deducida «anuncio»**; una publicación (`source_type: "post"`) se enseña pero
   no cuenta como anuncio.
4. La reentrega del mismo mensaje no lo duplica, y un segundo mensaje con **otro**
   anuncio no cambia el primero.
5. Un `referral` sin `source_id`, `ctwa_clid`, `headline` ni `source_url` no crea
   anuncio, y el mensaje entra.

### La imagen

1. Se copia sola y se sirve como PNG por `/api/media/{id}` con sesión; sin
   sesión, 401.
2. Otra persona del mismo anuncio comparte la misma imagen.
3. Un host que no es de Meta, una redirección a otro host, un SVG y una imagen de
   más de 300 KB quedan **sin imagen**, con la tarjeta y el mensaje intactos.
4. Una descarga que se cuelga una vez llega con el reintento; una que falla dos
   veces llega sin imagen y **abrir el contacto la repara**.

### En pantalla

1. El renglón dice «Anuncio · titular»; el orgánico, nada.
2. El filtro **Anuncios** aparece y deja solo las conversaciones de anuncio.
3. El panel enseña la tarjeta con la imagen **cargada** (no un ícono roto),
   «Ver anuncio» con el enlace https de Meta, «con video» en un anuncio de
   video, y «Meta identificó el clic» solo con la bandera encendida.
4. Una conversación orgánica no enseña tarjeta.
5. La misma tarjeta sale en el cajón del trato del pipeline.
6. A 390 px, la bandeja y el panel con la tarjeta no se desbordan a lo ancho.

**Pendiente de verificación humana**: un clic real en un anuncio CTWA hacia un
número conectado. El mock reproduce la forma del `referral` de la documentación
de Meta, no un clic.
