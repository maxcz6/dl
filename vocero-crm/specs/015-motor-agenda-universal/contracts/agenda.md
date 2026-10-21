# Contrato de API — Agenda (feature 015)

Toda esta superficie existe SOLO con `AGENDA=on`; apagada, **cada ruta de este
documento responde `404`** (el endpoint no existe en esta instancia — mismo
criterio que un canal apagado, ADR-001).

Errores con el sobre estándar del repo: `{"error":{"code":"…","message":"…"}}`
— **anidado**. En los `409` de agenda, `slots` viaja como campo **hermano** de
`error`. La forma es contrato: en el fork, un mock con el sobre plano ocultó el
camino de re-oferta durante semanas.

Instantes **siempre en UTC ISO-8601 con `Z`**. Las etiquetas (`label`,
`dayLabel`) vienen formateadas en la zona del negocio e **incluyen el día en
palabras** — la etiqueta corta sin día ya agendó una cita el día equivocado en
producción ("10:30, de mañana" respondida a una oferta de HOY).

---

## ⚠️ Códigos de creación y mutación: 201 / 200 exactos

- **`POST /api/bookings` y `POST /api/bot/bookings` responden `201` al crear**,
  no 200. Un cliente que valide `status === 200` fallará con TODA reserva
  (pasó en producción: ningún lead pudo agendar durante horas y los mocks no lo
  vieron). Si escribes un cliente: acepta `2xx`, nunca compares contra 200.
- **`PATCH` (reprogramar) responde `200`**. La asimetría 201/200 es
  deliberada y VERIFICADA por el arnés E2E comparando códigos exactos en ambos
  lados del contrato.

---

## Superficie de operador (sesión autenticada)

### `GET /api/calendar/settings`

```json
{ "settings": {
    "weeklyHours": { "mon": [{ "start": "09:00", "end": "18:00" }] },
    "slotMinutes": 30, "bufferMinutes": 0, "minNoticeHours": 2,
    "maxDaysAhead": 7, "timezone": "America/Mexico_City",
    "connector": "enlace-fijo", "meetingLink": null } }
```

Instancia sin configurar ⇒ defaults con `200` (no 404). Jamás incluye
credenciales de conectores (esas viven en sus propios endpoints, solo `last4`).

### `PUT /api/calendar/settings`

Body: cualquier subconjunto. Enteros fuera de rango se recortan; intervalos
inválidos se descartan; `timezone` desconocida ⇒ `422 invalid_body`;
`connector` fuera del catálogo ⇒ `422 invalid_body`. `meetingLink`:
`string | null` (cadena vacía se guarda como `null`).

### `GET /api/calendar/availability?from=YYYY-MM-DD&to=YYYY-MM-DD`

`200` → `{ "slots": [{ "startUtc", "endUtc", "label", "dayIso", "dayLabel", "time" }] }`
— vacío ⇒ `{"slots":[]}` con `200`. **No** registra oferta (vista del
operador).

### `GET /api/bookings`

`200` → `{ "bookings": [{ id, kind, status, source, scheduledAtUtc,
durationMinutes, date, time, weekday, contact: {id,name}|null, conversationId,
connector, meetingLink, linkPending, isTest, notes }] }`

### `POST /api/bookings`

Dos formas, discriminadas por `kind`:

```jsonc
{ "kind": "session", "contactId": "ct_…", "conversationId": "cv_…", // opcional
  "startUtc": "2026-09-01T15:00:00.000Z", "notes": "…" }            // notes opcional

{ "kind": "block", "startUtc": "…", "durationMinutes": 60, "notes": "…" }
```

- **`201`** → `{ "booking": { "id": "bk_…" }, "meetingLink": "…"|null,
  "linkPending": false|true, "label": "…" }`
- `409 slot_taken` · `422 invalid_body`

El operador no pasa por `offered_slot` (elige de la disponibilidad que ve); la
re-validación y el candado atómico anti doble-booking sí aplican.

### `PATCH /api/bookings/{id}`

```jsonc
{ "action": "reschedule", "startUtc": "…" }
{ "action": "cancel" }
{ "action": "status", "status": "realizada" | "no_show" }
{ "action": "retry_link" }        // re-invoca createMeeting del conector de ORIGEN
```

- `200` → `{ "ok": true }` (+ `label` en reschedule; + `meetingLink` en
  `retry_link` exitoso)
- `404 not_found` · `409 slot_taken` (reschedule a hueco tomado) · `422
  invalid` (reprogramar una cancelada; `retry_link` sin link pendiente)
- Cancelar una ya cancelada ⇒ `200` sin cambios (idempotente).

### Conectores: `/api/settings/zoom` y `/api/settings/google`

Mismo molde que `/api/settings/whatsapp` e instagram:

- `GET` → forma pública: campos en claro + `secretLast4` (+ `refreshTokenLast4`
  en google) + `status: "connected"|"error"`. Sin credenciales ⇒
  `{ "connected": false }`.
- `PUT` → **valida contra el proveedor ANTES de persistir** (`testConnection`);
  falla ⇒ `422 zoom_invalid` / `422 google_invalid` y NO guarda. Éxito ⇒
  cifra y guarda, `status = "connected"`.
- `DELETE` → desconecta (borra la fila). Citas futuras de ese conector siguen
  vivas; sus efectos externos degradan best-effort.
- `POST …/test` → prueba sin guardar: `200 {ok:true}` / `422`.

---

## Superficie de servicio (`X-API-Key: BOT_API_KEY`)

Sin llave configurada, 401 en toda la superficie — igual que el resto de
`/api/bot/*`. Con `AGENDA` apagada, 404 (la bandera se evalúa antes que la
llave: el endpoint no existe).

### `GET /api/bot/availability?conversationId=cv_…&limit=12&perDay=3&days=5[&date=YYYY-MM-DD]`

Devuelve los huecos **y registra la oferta** para esa conversación (reemplazo
completo). Con `perDay`, reparte entre días: el **catálogo reservable**
(`limit`) es más ancho que el **menú** que el agente muestra — guardar solo lo
mostrado dejó al agente sin nada que ofrecer cuando el lead pedía otro día.

Sin `date` es un **reparto**: hasta `perDay` horas de cada día (las primeras),
hasta `limit` en total, dentro de los próximos `days` días. Lo que falta en la
lista no está necesariamente ocupado, y `query` dice hasta dónde llega:

```json
{
  "slots": [{ "startUtc", "endUtc", "label", "dayIso", "dayLabel", "time" }],
  "diasConAgenda": ["2026-09-21", "2026-09-22", …],
  "query": {
    "date": null,
    "status": null,
    "coveredUntil": "2026-09-24",
    "horizonEnd": "2026-09-28",
    "perDay": 3
  }
}
```

- un día **después** de `coveredUntil` no se revisó (si el reparto no se
  llenó, `coveredUntil` es el fin de la ventana: lo ausente sí está cerrado);
- un día que aparece puede tener **más horas** que las `perDay` enseñadas;
- `horizonEnd` es el último día agendable (hoy + `maxDaysAhead`).

Para contestar «¿mañana en la tarde?» o «¿el jueves a las 11?» se pide **ese
día** con `date` (fecha en la zona del negocio). Devuelve sus horas libres
—**todas** hasta 24; si hay más, 24 repartidas a lo largo del día, primera y
última incluidas— con la misma forma, y `query.date` = el día pedido,
`coveredUntil` = ese día, `perDay: null`. Con `date`, `limit`/`perDay`/`days`
no aplican. `query.status`:

| `status` | Qué significa | `slots` |
|---|---|---|
| `available` | hay horas libres ese día | las del día; **pasan a ser la oferta** |
| `closed` | ese día el negocio no abre | `[]` |
| `full` | abre, pero no queda nada libre (o ya no da el aviso mínimo) | `[]` |
| `past` | el día ya pasó | `[]` |
| `beyond_horizon` | todavía no se abre agenda para esa fecha (> `horizonEnd`) | `[]` |

Una consulta por día **sin** horas **no borra** la oferta vigente: el cliente
que oye «ese día no abrimos» todavía puede quedarse con lo que ya se le dio.
Un cerebro que no recibe `query.date` igual al día pedido (un CRM anterior a
esto ignora `date`) no debe afirmar nada de ese día.

- `200` → lo de arriba.
- `422 invalid_body` → falta `conversationId`, o `date` mal formada o
  inexistente en el calendario (`2026-02-31`). `date=` vacía cuenta como
  ausente.
- `404 not_found` → conversación inexistente.
- Clamps: `limit` 1–48 (default 12), `perDay` 1–8 (default 3), `days` 1–14
  (default 5); un parámetro ausente o vacío toma su default.
- `{"slots":[]}` sin `date` = agenda sin huecos: ofrece otra salida (handoff),
  no reintentes.

### `POST /api/bot/bookings`

```json
{ "conversationId": "cv_…", "startUtc": "2026-09-01T15:00:00.000Z", "notes": "…" }
```

| Caso | Código | Cuerpo | Qué hacer |
|---|---|---|---|
| Creada | **`201`** | `{ "bookingId", "meetingLink": …\|null, "linkPending": bool, "label" }` | Confirmar con ESA etiqueta. Comparte el link solo si no es `null`; con `linkPending: true` di que el enlace llega por este medio — no prometas lo que no tienes |
| No se ofreció | `409` | `{ "error": {"code":"slot_not_offered", …}, "slots": [lo que sí se ofreció] }` | No inventes horarios: re-ofrece los de la lista |
| Se ocupó | `409` | `{ "error": {"code":"slot_taken", …}, "slots": [alternativas frescas YA registradas como nueva oferta] }` | Discúlpate y ofrece esas; **no** hubo cita |
| Sin conversación | `404` | `{ "error": {"code":"not_found"} }` | — |
| Payload inválido | `422` | `{ "error": {"code":"invalid_body"} }` | — |

**Garantías**: (1) un `409` NUNCA deja cita creada — si recibes 409 no
confirmes nada; (2) las alternativas del `slot_taken` ya son la oferta vigente:
puedes reservar una de inmediato; (3) reservar dos veces el mismo instante para
la misma conversación no duplica — la segunda recibe `409` porque el hueco lo
ocupa la primera; (4) la atomicidad es de base de datos: dos confirmaciones
concurrentes jamás producen dos citas activas en el mismo instante.

### `PATCH /api/bot/bookings`

```json
{ "conversationId": "cv_…", "startUtc": "2026-09-02T16:00:00.000Z" }
```

Reprograma la **próxima cita activa** del contacto de esa conversación al nuevo
instante, bajo las mismas reglas de oferta (el nuevo instante debe estar
ofrecido). Existe para que mover una cita no exija pausar la IA ni traspasar a
humano (incidente real del fork).

- **`200`** → `{ "bookingId", "meetingLink": …|null, "label" }` — el link se
  conserva (misma reunión, movida).
- `404 not_found` (sin cita activa) · `409 slot_not_offered`/`slot_taken` (con
  `slots`) · `422 invalid_body`.

**Cancelar por esta superficie NO existe en v1**: esa decisión es del dueño —
el camino es handoff.

### `GET /api/bot/context` → `booking`

> Añadido después de la implementación de 015 (aditivo, sin migración): se
> porta de la edición cloud, donde se diseñó y se verificó en vivo con Nea.

A diferencia del resto de esta sección, el contexto existe siempre (es de
`/api/bot/*`, no de la agenda): lo que depende de la bandera es **un campo**.
Con `AGENDA=on` trae las citas del contacto; apagada, `booking` **falta** — ni
`null` ni vacío, porque un bloque vacío se leería como «este lead no tiene
cita».

```json
{
  "booking": {
    "timezone": "America/Mexico_City",
    "next": {
      "id": "bk_…",
      "status": "agendada",
      "startUtc": "2026-09-15T15:00:00.000Z",
      "endUtc": "2026-09-15T15:30:00.000Z",
      "label": "mañana martes, 15 de septiembre, 09:00",
      "meetingLink": "https://meet.google.com/…",
      "linkPending": false
    },
    "unresolved": null,
    "lastClosed": {
      "id": "bk_…",
      "status": "cancelada",
      "startUtc": "…", "endUtc": "…", "label": "…",
      "closedAt": "2026-09-14T22:00:00.000Z",
      "cancelledBy": "equipo"
    }
  }
}
```

- `next` es la próxima cita `agendada`: la misma que mueve `PATCH
  /api/bot/bookings`. `null` si no hay.
- `unresolved` es la última que **ya empezó** (hasta 7 días atrás) y nadie
  marcó como realizada ni no-show. Si el cliente escribe «no pude entrar»,
  habla de ésta; con `endUtc` sabes si todavía está en curso.
- `lastClosed` es la última cita que se **cerró** en los últimos 7 días
  (`cancelada`, `no_show` o `realizada`) con `closedAt`. No trae enlace: ya no
  sirve. `cancelledBy` solo en las canceladas, y aquí siempre es `equipo`:
  cancelar no existe por esta superficie, así que solo se cancela desde el
  panel. (La edición cloud, donde el cerebro sí cancela, también usa `agente`.)
- `label` trae el día en palabras relativo a *ahora* («hoy», «mañana») en la
  zona de `timezone`. Los instantes, en UTC con `Z`.
- Las citas **de prueba** (Laboratorio) no aparecen nunca, y los bloqueos del
  operador tampoco: no son de ningún contacto.
- Si la lectura de las citas falla, `booking` falta y el resto del contexto
  sale igual: sin contexto un cerebro se calla, y la agenda es opcional.

Es la verdad sobre las citas; el historial no lo es: no se entera de que una
hora ya pasó ni de que el equipo canceló desde el panel. Un cerebro que afirma
citas solo por el historial acaba reservando una segunda cita para quien no
llegó a la primera. Misma forma que la edición cloud (más `status` en las
vigentes), para que un cerebro sirva contra las dos.

---

## Agente in-process

Con la bandera encendida, el agente incluido gana dos acciones —
`offer_slots {reply?}` y `book_slot {startUtc, reply?}` — bajo las mismas
reglas: el modelo NO redacta horarios (pide ofrecer y el motor adjunta las
etiquetas reales al mensaje), y `book_slot` solo acepta un `startUtc` que el
propio flujo ofreció antes en esa conversación; si no, el motor lo rechaza y se
re-ofrece. Un fallo del motor degrada el turno (responde sin agendar), nunca lo
tumba. Con la bandera apagada, las acciones no se registran y el prompt no las
menciona.
