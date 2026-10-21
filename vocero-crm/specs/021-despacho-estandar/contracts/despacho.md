# Contrato — El despacho (CRM → cerebro)

Lo que el CRM le manda a un cerebro externo cuando un cliente escribe. Es la
mitad nueva del contrato; la otra mitad, por donde el cerebro contesta, es
`/api/bot/*` y no cambia.

1. **CRM → cerebro**: un `POST` firmado con el evento normalizado (este
   documento).
2. **cerebro → CRM**: `/api/bot/*` con `X-API-Key` (README, «Trae tu propio
   agente»).

El cerebro **nunca** recibe credenciales de canal ni habla con Meta o Zernio.

La forma del evento y la firma son las del despacho de Vocero Cloud
(`specs/101-edicion-cloud-comunidad/contracts/cerebro.md` en ese repo), para
que un mismo cerebro sirva a las dos ediciones. Las diferencias están marcadas.

## Lo que rompe integraciones, dicho antes que nada

- **La firma se calcula sobre el cuerpo CRUDO**, byte a byte, antes de parsear
  JSON. Si tu framework re-serializa el cuerpo para verificar, la firma no
  coincide nunca.
- **`dispatchId` es la clave de idempotencia.** El CRM reintenta: el mismo
  `dispatchId` dos veces es *el mismo despacho*, no dos turnos.
- **Responde 2xx rápido y piensa después.** El 2xx significa «recibido», no
  «ya contesté». El CRM espera 20 s; la respuesta al cliente se envía por
  `/api/bot/messages` cuando esté lista.
- **Un despacho cubre una ráfaga**, no un mensaje: lo que el cliente dijo desde
  la última respuesta. Si escribe otra vez antes de que contestes, el siguiente
  despacho repite los mensajes anteriores junto con el nuevo. Deduplica por
  `messages[].id`. Una ráfaga trae como mucho los últimos 20 mensajes.
- **Un mensaje puede ser anterior a tu última respuesta** (025). El cliente
  escribe «¿y hacen envíos?» mientras tú todavía piensas la respuesta a
  «¿tienen taladros?». Tu respuesta sale, y unos segundos después te llega un
  despacho con ese segundo mensaje, que por hora quedó ANTES de lo que
  contestaste. No lo habías leído: contéstalo. Si ordenas tu historial por
  hora, no concluyas que ya está atendido solo porque después viene una
  respuesta tuya; guíate por los ids.
- **`messages` nunca llega vacío** (025). Trae al menos un mensaje. Si una
  persona del negocio contestó dentro de la ventana, ese mensaje ya está
  atendido y no se te despacha nada.
- **No todo lo que llega a esta URL es un turno** (026). Un cuerpo con `type`
  es un evento, no un despacho: hoy, `conversation.deleted`. Mira `type` (o
  la cabecera `x-vocero-event`) antes de buscar `messages`. Ver «Eventos que
  no son un turno».
- **Un `conversation.id` nuevo para una identidad que ya conocías es una
  conversación nueva** (026). El negocio pudo haber eliminado la anterior:
  olvida lo que recordabas de esa persona y empieza de cero. Es la regla que
  cubre un aviso de borrado que nunca te llegó.

## Cuándo se despacha

Con `BRAIN_DISPATCH_URL` y `BOT_API_KEY` configuradas, cada mensaje entrante
real de WhatsApp, Instagram o Messenger encola un despacho, salvo que la
conversación tenga la IA en pausa o esté traspasada a un humano. El CRM espera
`AGENT_COALESCE_MS` desde el último mensaje (6 s por defecto) para juntar la
ráfaga.

Mientras el despacho está activo, el agente incluido no contesta.

## La petición

```
POST {BRAIN_DISPATCH_URL}
Content-Type: application/json
X-Vocero-Signature: sha256=<hex>
X-Vocero-Dispatch-Id: dsp_…
X-Vocero-Organization: <slug, o el id si no hay slug>
```

`X-Vocero-Signature` = `HMAC-SHA256(cuerpo_crudo, BOT_API_KEY)` en hex, con el
prefijo `sha256=`. Compárala en tiempo constante.

`X-Vocero-Event` queda reservada para eventos que no son un turno. La raíz no
manda ninguno todavía; un cuerpo con `type` no es un despacho.

### Cuerpo

```json
{
  "dispatchId": "dsp_9f2a…",
  "organization": { "id": "org_…", "slug": "mi-negocio" },
  "conversation": {
    "id": "cv_…",
    "channel": "whatsapp",
    "aiEnabled": true,
    "windowOpen": true,
    "windowExpiresAt": "2026-10-09T04:12:00.000Z"
  },
  "contact": {
    "id": "ct_…",
    "displayName": "Ana",
    "identity": "5215512345678"
  },
  "messages": [
    { "id": "msg_…", "at": "2026-10-08T05:10:03.000Z", "type": "text",
      "text": "hola, ¿tienen disponible el modelo azul?", "mediaId": null },
    { "id": "msg_…", "at": "2026-10-08T05:10:11.000Z", "type": "image",
      "text": null, "mediaId": "1234567890", "mimeType": "image/jpeg",
      "caption": "este" }
  ],
  "firstMessageAt": "2026-10-08T05:10:03.000Z",
  "lastMessageAt": "2026-10-08T05:10:11.000Z"
}
```

El orden de las claves es el de arriba y es contrato: se firma el JSON tal como
sale, y `tests/unit/despacho-contrato.test.ts` fija un cuerpo y su firma byte a
byte. La prueba gemela vive en el repo del cerebro.

Notas que son contrato:

- **`channel`** es `whatsapp`, `instagram`, `messenger` o `tiktok` (022), y
  la lista crecerá.
  Trátalo como informativo (tono, límite de longitud), no hagas un `switch`
  exhaustivo.
- **`identity`** es la llave estable del contacto, la misma que acepta
  `GET /api/bot/context?identity=…`: teléfono normalizado, `bsuid:<id>`,
  `ig:<id>` o `fb:<id>`. **Puede no haber teléfono.**
- **`conversation.id`** es el `conversationId` que piden `/api/bot/messages`,
  `/api/bot/handoff` y `/api/bot/typing`.
- **`windowOpen: false`** significa que un texto libre será rechazado con 409
  `window_closed`. La ventana es la del canal: 24 horas, o 48 en TikTok
  (`windowExpiresAt` ya la trae calculada). En Instagram y Messenger una
  persona puede contestar desde la bandeja hasta 7 días después; **el cerebro
  no** (024): esa extensión lleva la etiqueta de agente humano de Meta.
- **El texto que mandas a Instagram, Messenger o TikTok sale sin formato**
  (024): el CRM le quita las marcas de WhatsApp y de Markdown antes de
  enviarlo, porque esas redes no las dibujan. No tienes que saber el canal
  para escribir; a WhatsApp llega tal cual.
- **Un canal puede tener tope de mensajes** (022). TikTok admite 10 después
  del último mensaje del cliente; el siguiente `POST /api/bot/messages`
  responde 409 `message_limit`. No reintentes: se levanta cuando el cliente
  vuelve a escribir, y eso te llega como un despacho nuevo.
- **`conversation.test: true`** (033) marca una corrida del **Laboratorio**:
  un cliente simulado con guion, una línea por despacho y sin ventana de
  agrupado. La llave solo aparece en esas; en una conversación real falta.
  Contesta igual que siempre, por `/api/bot/messages`: el CRM **guarda** la
  respuesta en el hilo y no la envía a ningún lado (200). No la trates como un
  cliente: su identidad es sintética (no la filtres por tu lista de
  permitidos) y no le programes seguimiento. Al terminar cada caso te llega
  `conversation.deleted` de esa conversación. El CRM espera tu respuesta hasta
  90 s por línea.
- **`aiEnabled: false`** no debería llegarte: una conversación en pausa no se
  despacha. Viaja para que un cerebro defensivo pueda ignorarla.
- **`mediaId`** se descarga por `GET /api/bot/media/{mediaId}`. Los adjuntos no
  vienen en el cuerpo. `mimeType` y `caption` solo aparecen si hay adjunto.
  *Diferencia con cloud*: allá `mediaId` es el id interno del adjunto y se
  descarga por `/api/brains/media`; aquí es el que acepta `/api/bot/media`.
- **Lo que un cerebro leía del webhook de Meta viaja aquí** (031). Tres
  llaves opcionales, después de las de arriba, y solo cuando aplican:
  - `fileName`: el nombre del archivo, si el adjunto lo trae (un PDF, casi
    siempre).
  - `location`: `{latitude, longitude, name?, address?}` si `type` es
    `location`. `name` y `address` faltan cuando la persona compartió un pin
    suelto.
  - `contacts`: `[{name}]` si `type` es `contacts`: los nombres de las
    tarjetas que compartió.
  Un mensaje que no las necesita no las lleva, así que un cuerpo de antes de
  la 031 sigue siendo válido byte a byte.
- **Sin `capabilities`, `brainGeneration` ni `expiresAt`.** Son de la agenda v2
  de cloud. *Diferencia con cloud*: aquí la agenda va por
  `/api/bot/availability` y `/api/bot/bookings`.
- Agregar una llave al evento no es un cambio que rompa. Quitar o renombrar una,
  sí: ignora las que no conozcas.

## Qué entiende el CRM de tu respuesta

| Código | Qué hace el CRM |
|---|---|
| `2xx` | Recibido. El despacho queda `entregado`. |
| `429`, `5xx`, sin respuesta en 20 s, conexión rechazada | Reintenta. |
| Cualquier otro `4xx` | **No reintenta**: mandar tres veces un cuerpo que consideras inválido solo retrasa a la persona que va a atender. Cae a humano. |
| `3xx` | No sigue redirecciones. Cuenta como un `4xx`. |

## Reintentos y caída a humano

Tres intentos en total, con esperas de `1 s → 4 s` entre ellos (más un poco de
variación para que no reintenten todos a la vez). Agotados, o ante un 4xx:

- el despacho queda `caducado_a_humano` con el motivo;
- la conversación pasa a un humano: IA en pausa con motivo `error`, igual que
  si el cerebro hubiera llamado a `POST /api/bot/handoff`;
- la bandeja lo ve en vivo.

Esa conversación no vuelve a despacharse hasta que alguien reactive la IA desde
la bandeja. El mensaje del cliente **ya está en la bandeja** en todos estos
caminos.

## Eventos que no son un turno

### `conversation.deleted` (026)

Quien administra el negocio eliminó una conversación desde la bandeja. El CRM
ya la borró —mensajes, adjuntos y ficha— y te pide que la olvides tú también.

Llega por `POST` a la **misma URL** y con la **misma firma** que un despacho.

| Cabecera | Valor |
|---|---|
| `x-vocero-signature` | `sha256=<hmac del cuerpo crudo>`, con `BOT_API_KEY`, igual que un turno |
| `x-vocero-event` | `conversation.deleted` |
| `x-vocero-organization` | El `slug` de la organización, o su `id` si no tiene |

No lleva `x-vocero-dispatch-id`: no es un despacho.

```json
{
  "type": "conversation.deleted",
  "eventId": "olv_4f8k2m9x1c7b3n5v0q6z",
  "organization": { "id": "org_…", "slug": null },
  "conversation": { "id": "cv_…", "channel": "whatsapp" },
  "contact": { "id": "ct_…", "identity": "5215550001111" },
  "deletedAt": "2026-10-13T12:00:00.000Z"
}
```

- **No trae nada de lo borrado**, solo con qué encontrarlo. `identity` va
  porque un cerebro suele indexar su memoria por persona, no por el id de
  conversación del CRM.
- **Qué hacer:** borrar lo que guardes de esa conversación (historial,
  resúmenes, lo que hayas aprendido de la persona en ella) y contestar 2xx.
  Si el contacto se eliminó también, llega igual: un evento por conversación.
- **Se intenta una vez**, con 8 segundos de espera, y no se reintenta. El
  borrado en el CRM no depende de tu respuesta. Si no contestas 2xx, quien
  eliminó ve que no confirmaste; la regla del `conversation.id` nuevo (arriba)
  es la que evita que uses memoria de algo que ya no existe.
- **`eventId`** identifica el aviso, por si tu infraestructura lo entrega dos
  veces.
- Contestar 4xx a un evento que no conoces es inofensivo: no pausa la
  conversación ni cuenta como fallo del despacho.
- Es el mismo evento que manda Vocero Cloud. El orden de las claves es
  contrato: una prueba gemela lo fija byte a byte en este repositorio
  (`tests/unit/olvido-contrato.test.ts`) y en el del cerebro.

## Cómo contestar

Igual que antes de que existiera el despacho:

1. `GET /api/bot/context?conversationId={conversation.id}` (o por `identity`)
   si necesitas la etapa, la ficha, el traspaso, las citas o **de qué anuncio
   llegó la persona** (031): `adOrigen` es `{headline, body, sourceType,
   sourceUrl, hasCtwaClid, capturedAt}` o `null`. Es lo que antes venía en el
   `referral` del webhook de Meta; el identificador del clic no sale del CRM.
2. `POST /api/bot/messages` con `conversationId` y `text`.

Un 409 `ai_paused` al contestar significa que un humano tomó la conversación
mientras pensabas: no insistas.

En una conversación de prueba (`conversation.test`), `POST /api/bot/messages`
responde 200 y guarda el mensaje sin enviarlo (033); hasta la 032 respondía 409
`sandbox_violation`.
