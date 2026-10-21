# E2E — Motor de agenda universal (015)

Guion de comportamiento observable. Automatizado en la sección `015` de
`scripts/e2e-selftest.mjs`: con la app viva y los mocks encendidos,
`pnpm test:e2e` lo conduce y sale distinto de cero si algo falla.

**Preparación**: app en `localhost` con `WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock, `ZOOM_BASE_URL`/`ZOOM_OAUTH_BASE_URL` →
zoom-mock, `BOT_API_KEY` y la BD migrada. La bandera `AGENDA` decide qué mitad
del guion corre: ambas se ejercitan en la matriz de CI.

---

## US1 — La instancia decide si la agenda existe

Con `AGENDA` ausente:

1. `GET /api/calendar/settings`, `/api/calendar/availability` y `/api/bookings`
   responden **404**.
2. `GET /api/bot/availability` responde **404** — antes incluso de mirar la
   llave: el endpoint no existe aquí.
3. La pantalla `/bookings` responde 404 y la navegación no la menciona.

4. `GET /api/bot/context` **no** trae `booking` — ni vacío: un bloque vacío en
   una instancia sin agenda se leería como «este lead no tiene cita».

Con `AGENDA=on`, las mismas rutas responden con normalidad, y el contexto trae
`booking` (sin citas: `next`, `unresolved` y `lastClosed` en `null`).

## US2 — El negocio define cuándo atiende

1. Una instancia recién encendida devuelve **defaults usables** (cita de 30
   min, conector `enlace-fijo`) con 200, no un 404.
2. Se guarda un horario y una sala fija; la disponibilidad devuelve huecos.
3. Cada hueco trae el **día en palabras** además de la hora — la etiqueta corta
   ya agendó una cita el día equivocado en producción.
4. Una zona horaria inventada se rechaza con **422** en vez de guardarse y
   romper el motor después.

## US3 — Las dos garantías

1. **Solo se reserva lo que se ofreció**: un instante libre y válido, pero
   nunca ofrecido a esa conversación, se rechaza con `409 slot_not_offered` y
   la respuesta trae lo que sí se ofreció.
2. **Camino feliz**: reservar un hueco ofrecido responde **201 Created** (no
   200), con etiqueta y enlace; el hueco desaparece de la disponibilidad y la
   cita aparece en Citas marcada como agendada por la IA.
3. **La carrera**: un segundo intento sobre el mismo instante responde `409`
   con el sobre **anidado** y `slots` como **hermano**; en la base queda **una
   sola cita activa** en ese instante.
4. Las alternativas del `409` ya son la oferta vigente: reservar una de ellas
   responde 201 de inmediato.
5. **Reprogramar** por la superficie del bot responde **200**, no 201.
6. **El contexto del cerebro sabe de la cita**: tras reservar,
   `GET /api/bot/context` trae `booking.next` con el id de ESA cita, su
   `startUtc`/`endUtc`, `status: "agendada"`, la etiqueta con el día en
   palabras en la zona del negocio (`booking.timezone`) y el enlace que se le
   dio al cliente. Tras reprogramar, la misma cita en su instante nuevo. Sin
   esto un cerebro solo conoce la cita por el historial: reserva una segunda
   para quien no llegó a la primera, o da por vigente una que ya pasó.

## US3b — Un día concreto (huecos por fecha)

Un lead propio, al final de la sección 015 del arnés, que pregunta «¿tienen
algo mañana en la tarde?». En la prueba de punta a punta raíz + Nea, sin esto,
el cerebro solo veía las tres primeras horas de mañana y contestó que solo
había mañana.

1. **Sin `date`, la forma de siempre**: `slots` (con `startUtc`, `endUtc`,
   `label`, `dayIso`, `dayLabel`, `time`) y `diasConAgenda`, más `query` con
   `date: null`, `perDay: 3`, `coveredUntil` y `horizonEnd`.
2. **Con `date` = mañana**: 200 con `query.date` = ese día y
   `query.status: "available"`; solo horas de ese día, más de las tres del
   reparto, y alguna de la tarde.
3. Un día más allá del horizonte responde `beyond_horizon` sin horas, y una
   fecha inexistente (`2026-02-31`) **422 `invalid_body`** — ninguna de las dos
   borra la oferta vigente.
4. **Reservar** una hora de la tarde ofrecida por fecha responde **201**, con
   esa hora en la etiqueta, y deja de ofrecerse para ese día.

## US4 — El operador

1. Cancelar dos veces no falla (idempotente). Cancelada desde el panel, el
   contexto del cerebro ya **no** la da por vigente (`booking.next`) y la trae
   en `booking.lastClosed` con `status: "cancelada"`, `cancelledBy: "equipo"`
   y sin enlace: así el cerebro dice «se canceló» en vez de inventar un motivo.
2. Reintentar el enlace de una cita que ya lo tiene responde 422.
3. **El proveedor caído no cuesta la conversión**: con el conector externo sin
   credenciales, reservar responde **201 igualmente**, con
   `linkPending: true` y `meetingLink: null`, y la cita se ve como "sin enlace"
   en Citas.

## US5 — Conector Zoom

1. Unas credenciales que el proveedor rechaza responden 422 y **no se
   guardan**: la conexión sigue sin existir.
2. Unas válidas se guardan y hacia el navegador solo salen sus **últimos 4** —
   el secreto no aparece en la respuesta.
3. Agendar crea la reunión: el proveedor la recibe con su tema y su hora, y el
   enlace vuelve en la respuesta.
4. Cancelar la cita **borra** la reunión en el proveedor.

## US6 — Conector Google

Cubierto por la suite de contrato (`tests/unit/connectors.test.ts`), que fija
lo que su mock reproduce: el enlace de Meet **no** viene en la respuesta de
crear el evento —la conferencia es asíncrona—, el conector re-lee, y si sigue
pendiente entrega el evento sin enlace en vez de fallar. Reintentar re-lee ese
mismo evento: **nunca** crea uno duplicado en el calendario del dueño.

## Sandbox del Laboratorio

1. Una conversación de prueba **puede** agendar (201) y la cita queda marcada
   como de prueba.
2. Con un conector externo activo, el estado del mock queda **vacío**: el
   proveedor jamás se entera de una cita de prueba. Se verifica por ausencia, y
   vale igual para crear, reprogramar y cancelar.
