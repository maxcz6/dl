# Conectores de agenda

Un **conector** es la forma en que una cita del CRM se convierte en una reunión
de verdad. El motor de agenda no sabe de proveedores: sabe *cuándo* atiende el
negocio y *quién* reservó. Entregar la reunión es trabajo del conector.

Esa separación es lo que hace que agregar Teams, Outlook, CalDAV o Cal.com en
tu fork sea escribir un archivo y una tabla — no pelearte con el motor.

> Los conectores que hablan con un servicio externo existen bajo cinco
> condiciones constitucionales (Principio II, v1.4.0): apagados por defecto,
> aislados tras su adaptador, con un camino sin dependencia que funcione igual,
> credenciales cifradas del propio negocio, y probados en CI encendidos y
> apagados. Un conector que no las cumpla no entra al core.

## Los que vienen incluidos

### Enlace fijo (`enlace-fijo`) — el default

Tu sala de siempre. Pegas la URL una vez en Ajustes → Agenda y cada cita la
reparte. No habla con nadie, no pide credenciales y no puede fallar. Si lo
dejas vacío, las citas se agendan igual y sin enlace: nadie promete lo que no
tiene.

Es también la razón de que encender la agenda no te obligue a conectar nada.

### Zoom (`zoom`)

Cada cita crea su propia reunión de Zoom. Reprogramar la mueve conservando el
mismo enlace; cancelar la borra.

**Qué necesitas**: una app **Server-to-Server OAuth** en el Marketplace de Zoom
(la crea el negocio, en su propia cuenta). De ahí salen los tres datos que se
pegan en Ajustes → Agenda: *Account ID*, *Client ID* y *Client Secret*.

**Los cuatro permisos (scopes)**:

```text
meeting:write:meeting     crear la reunión
meeting:update:meeting    moverla al reprogramar
meeting:delete:meeting    borrarla al cancelar
user:read:user            leer tu usuario
```

> ⚠️ El cuarto se olvida siempre. Es el que usa el botón **Probar**: sin él, la
> conexión falla aunque tus credenciales sirvan perfectamente para crear
> reuniones, y el mensaje de error no lo dice.

### Google Calendar + Meet (`google`)

Cada cita crea un evento en tu calendario con su enlace de Meet. Su
diferencial: la cita aparece donde ya miras tu día.

**Qué necesitas**: un proyecto en Google Cloud **del propio negocio** con la
API de Calendar activada, y de ahí *Client ID*, *Client Secret* y un *refresh
token* con el permiso `calendar.events`. El calendario destino es `primary`
salvo que pongas otro.

> ⚠️ **Publica tu app OAuth "en producción".** Si la dejas en modo prueba,
> Google **revoca el refresh token a los 7 días** y tus citas dejarán de generar
> enlace sin previo aviso. Cuando pasa, el CRM marca la conexión como rota y te
> lo muestra en Ajustes — pero la semana perdida no se recupera.

Dos detalles que este conector resuelve por dentro, y que conviene conocer si
escribes uno parecido: la conferencia de Meet se crea **de forma asíncrona** (la
respuesta de crear el evento puede venir sin enlace), así que el conector
re-lee el evento; y si aun así no llegó, la cita se entrega con el evento
creado y el enlace pendiente — reintentarlo **re-lee ese mismo evento**, nunca
crea uno duplicado en tu calendario.

## Qué pasa cuando el proveedor falla

Nada que te cueste una cita. El orden es deliberado: **primero se escribe la
verdad en el CRM, después se habla con el proveedor**. Si el proveedor está
caído, rechaza las credenciales o simplemente tarda:

1. La cita **se crea igual** y se responde `201`, con `linkPending: true` y sin
   enlace.
2. Quien confirma al cliente dice que el enlace llega en un momento, en vez de
   prometer uno que no existe.
3. La cita aparece en **Citas** marcada "sin enlace", con un botón para
   **reintentar**.
4. Si el fallo fue de autenticación, la conexión queda marcada como rota en
   Ajustes, con su tarjeta de reconexión.

## Escribe tu conector

El contrato son **cuatro operaciones** (más una opcional). No es un mínimo
prudente: es exactamente lo que el uso real necesitó en un CRM en producción
durante meses.

```ts
// src/server/agenda/connectors/types.ts
createMeeting(creds, { topic, startUtc, durationMinutes, timezone, notes? })
  → { externalId, joinUrl }
updateMeeting(creds, externalId, { startUtc, durationMinutes, timezone })
  → void                      // al reprogramar; conserva el enlace
deleteMeeting(creds, externalId) → void   // al cancelar; un 404 es ÉXITO
testConnection(creds) → { ok: true } | { ok: false, error }

// Opcional, solo si tu proveedor genera el enlace de forma asíncrona:
refreshMeeting?(creds, externalId) → { externalId, joinUrl }
```

Reglas que hace cumplir el motor, no tú:

- **Best-effort.** Una excepción tuya jamás revierte ni bloquea la cita.
- **Sandbox.** Una cita del Laboratorio nunca llega a un conector: la aserción
  vive antes de elegir cuál. No compruebes `is_test`; no te toca.
- **Idempotencia.** Borrar algo que ya no está es objetivo cumplido.
- **Sin free/busy.** El contrato no lee disponibilidad ajena, a propósito: la
  disponibilidad se calcula local, en una query, y meter al proveedor ahí
  acoplaría su latencia a la pantalla que más se usa. Si tu fork lo necesita,
  es una extensión — no un hueco.

### Los seis archivos que tocas

1. `src/lib/agenda-connectors.ts` — tu id y tu ficha (etiqueta, descripción,
   capacidades). Es lo que la pantalla de Ajustes muestra.
2. `src/server/agenda/connectors/<id>.ts` — el adaptador.
3. `src/server/agenda/connectors/<id>-credentials.ts` + `src/lib/db/schema.ts`
   y una migración aditiva — TU tabla, con TU forma. Tabla explícita, no un
   jsonb genérico: unas credenciales tienen forma fija y así conservan tipado e
   índices. Cifra con `@/lib/crypto`, como todos.
4. `src/server/agenda/connectors/index.ts` — una rama en el `switch`.
5. `src/app/api/settings/<id>/route.ts` (+ `test/`) — pegar credenciales,
   **validar contra el proveedor antes de guardar**, exponer solo los últimos 4.
6. `src/app/api/dev/<id>-mock/` — tu mock, con `_state`, `_reset` y un camino
   infeliz determinista.

Cero archivos del motor. Si te encuentras editando `service.ts` o
`availability.ts` para que tu conector funcione, algo se salió del contrato:
levanta un issue antes de forzarlo.

### Cómo sabes que funciona

`tests/unit/connectors.test.ts` es una suite de contrato **compartida**: la
misma para todos. Agrega tu conector ahí y haz que pase — es la definición de
"está bien escrito", y evita descubrir en producción que tu `deleteMeeting`
revienta con un 404 o que tu enlace no sobrevive a un reprogramado.
