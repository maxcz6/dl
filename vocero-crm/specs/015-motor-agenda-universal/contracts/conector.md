# Contrato de conector de agenda (feature 015)

El contrato público que separa el motor (genérico, soberano) de la entrega de
la reunión (por proveedor). Es deliberadamente pequeño: **cuatro operaciones**,
medidas del uso real en producción del conector Zoom del fork de agencia — ni
una más en meses de operación. Publicado también como guía en
`docs/agenda-conectores.md` (FR-022): esta extensibilidad es producto.

## El contrato (TypeScript)

```ts
// src/server/agenda/connectors/types.ts
export type MeetingRequest = {
  topic: string;            // "Cita — <nombre del contacto>"
  startUtc: string;         // ISO-8601 Z
  durationMinutes: number;
  timezone: string;         // IANA de la organización
  notes?: string;
};

export type MeetingResult = {
  externalId: string | null; // id de la reunión/evento en el proveedor
  joinUrl: string | null;    // lo que se le comparte al cliente
};

export type ConnectorCapabilities = {
  label: string;               // "Zoom", "Google Calendar + Meet", "Enlace fijo"
  perBookingLink: boolean;     // ¿genera un link por cita? (enlace-fijo: no)
  updatesMeeting: boolean;     // ¿reprogramar mueve la reunión en el proveedor?
  writesCalendarEvent: boolean;// ¿la cita aparece en el calendario del dueño?
  external: boolean;           // ¿habla con un servicio de terceros? (gate constitucional)
};

export type AgendaConnector<Creds> = {
  id: string;                  // "enlace-fijo" | "zoom" | "google" | el de tu fork
  capabilities: ConnectorCapabilities;

  createMeeting(creds: Creds, req: MeetingRequest): Promise<MeetingResult>;
  updateMeeting(creds: Creds, externalId: string,
                req: Pick<MeetingRequest, "startUtc" | "durationMinutes" | "timezone">): Promise<void>;
  deleteMeeting(creds: Creds, externalId: string): Promise<void>; // 404 del proveedor = éxito
  testConnection(creds: Creds): Promise<{ ok: true; detail?: string } | { ok: false; error: string }>;
};
```

Reglas del contrato (las hace cumplir el motor, no cada conector):

1. **El motor pregunta, no sabe** (mismo espíritu que
   `src/server/channels/capabilities.ts`): ninguna referencia a un proveedor
   fuera de su adaptador.
2. **Best-effort y después de la verdad**: el motor llama al conector DESPUÉS
   de escribir la cita; una excepción del conector jamás revierte ni bloquea la
   mutación. Fallo al crear ⇒ `link_pending`; 401 ⇒ además
   `status='error'` en la credencial.
3. **Sandbox**: el motor NUNCA invoca un conector para citas `is_test` — la
   aserción vive antes de la bifurcación, simétrica en crear / reprogramar /
   cancelar. Un conector no necesita (ni debe) comprobar `is_test`.
4. **Idempotencia**: `deleteMeeting` trata el 404 del proveedor como éxito
   ("ya no estaba: objetivo cumplido").
5. **Sin free-busy**: el contrato v1 no declara lectura de disponibilidad
   ajena, a propósito (research D4). La disponibilidad es 100% local.
6. **Free `AGENDA`**: todo el catálogo vive detrás de la bandera; un conector
   no gestiona la bandera.

## Catálogo v1

### `enlace-fijo` (incluido, sin dependencias — el default)

- `Creds = { meetingLink: string | null }` (de `calendar_settings`, no hay
  tabla de credenciales).
- `createMeeting` → `{ externalId: null, joinUrl: meetingLink }` (o `null`).
- `updateMeeting`/`deleteMeeting` → no-op. `testConnection` → siempre ok.
- Capacidades: `perBookingLink: false`, `updatesMeeting: false`,
  `writesCalendarEvent: false`, `external: false`.
- Es la razón de que encender la bandera no exija terceros (FR-002) y el camino
  sin dependencia que exige la condición 3 de la enmienda.

### `zoom` (Server-to-Server OAuth — referencia, probado en producción del fork)

- `Creds`: `accountId`, `clientId`, `clientSecret` (tabla `zoom_credentials`).
- Token: `POST {ZOOM_OAUTH_BASE_URL}/oauth/token?grant_type=account_credentials
  &account_id=…` con `Basic base64(clientId:clientSecret)`; caché en memoria
  por proceso, expiración anticipada 60 s, invalidada al cambiar credenciales.
- `createMeeting`: `POST /users/me/meetings` — `type: 2`, `topic`,
  `start_time` UTC sin milisegundos, `duration`, `timezone`,
  `settings: { join_before_host: true, waiting_room: false }` →
  `{ externalId: String(id), joinUrl: join_url }`.
- `updateMeeting`: `PATCH /meetings/{id}` solo con inicio/duración/zona —
  mismo id ⇒ mismo `join_url`.
- `deleteMeeting`: `DELETE /meetings/{id}`, 404 tolerado.
- `testConnection`: `GET /users/me`.
- **Scopes (granulares) — los CUATRO van en la guía**:
  `meeting:write:meeting`, `meeting:update:meeting`, `meeting:delete:meeting`
  y `user:read:user` (este último lo usa la prueba de conexión; la guía del
  fork lo omite y la validación fallaría con credenciales válidas).
- Capacidades: `perBookingLink: true`, `updatesMeeting: true`,
  `writesCalendarEvent: false` (la sincronización Zoom→Calendar la hace Zoom
  por su cuenta, si el dueño la tiene activa), `external: true`.
- Env solo para self-test: `ZOOM_BASE_URL` / `ZOOM_OAUTH_BASE_URL` apuntando al
  mock — declaradas en el esquema zod de `src/lib/env.ts` (no `process.env`
  directo: no repetir la inconsistencia de `IG_GRAPH_BASE_URL`).

### `google` (Calendar + Meet, REST directo sin SDK)

- `Creds`: `clientId`, `clientSecret`, `refreshToken`, `calendarId`
  (tabla `google_credentials`). App de Google Cloud **del negocio**, en estado
  "En producción" (en "Testing", los refresh tokens caducan a los 7 días —
  research D6; la guía lo advierte en negritas).
- Token: `POST https://oauth2.googleapis.com/token`
  (`grant_type=refresh_token`); caché en memoria como Zoom.
- `createMeeting`: `POST /calendars/{calendarId}/events?conferenceDataVersion=1`
  con `start`/`end` (UTC), `summary = topic`, `description = notes` y
  `conferenceData.createRequest` (Meet) →
  `{ externalId: event.id, joinUrl: <link de Meet del evento> }`.
  *(NEEDS VERIFICATION al implementar: confirmar que el link viene en la
  respuesta síncrona o si exige releer el evento; el mock imita lo confirmado.)*
- `updateMeeting`: `PATCH /calendars/{calendarId}/events/{id}` (fechas).
- `deleteMeeting`: `DELETE …/events/{id}`, 404 tolerado.
- `testConnection`: `GET /calendars/{calendarId}` (valida token y acceso).
- Scope: `https://www.googleapis.com/auth/calendar.events`.
- Capacidades: `perBookingLink: true`, `updatesMeeting: true`,
  `writesCalendarEvent: true` (su diferencial), `external: true`.
- Env de mock: `GOOGLE_CAL_BASE_URL` / `GOOGLE_OAUTH_BASE_URL` (zod, ídem).

## Mocks (FR-018)

Cada conector externo trae su mock bajo `src/app/api/dev/` tras `mockGuard()`
(404 incondicional en producción), siguiendo el molde del wa-mock y del
zoom-mock del fork: estado inspeccionable (`GET …/_state`), reset
(`POST …/_reset`) y camino infeliz determinista (client secret terminado en
`-invalid` ⇒ 401/400 del proveedor). El arnés E2E los usa para ejercitar
éxito, carrera, fallo-al-crear (link pendiente + reintento) y credencial
inválida.

## Guía "escribe tu conector" (para forks — se publica en `docs/agenda-conectores.md`)

Agregar un conector toca EXACTAMENTE estos archivos, y cero archivos del motor
(SC-006):

1. `src/server/agenda/connectors/<id>.ts` — el adaptador (implementa el
   contrato).
2. `src/server/agenda/connectors/index.ts` — una línea en el catálogo.
3. `src/lib/db/schema.ts` + migración aditiva — TU tabla de credenciales con TU
   forma (tabla explícita, secretos con `lib/crypto`; no jsonb genérico).
4. `src/app/api/settings/<id>/…` + panel en Ajustes — pegar credenciales,
   validar antes de guardar, exponer solo `last4`.
5. `src/app/api/dev/<id>-mock/…` — el mock con `_state`/`_reset` y camino
   infeliz.
6. `docs/agenda-conectores.md` — sección con credenciales requeridas, scopes y
   gotchas del proveedor.

Condición constitucional para conectores `external: true` (enmienda 1.4.0):
apagado por defecto, aislado, degradable, credenciales cifradas del negocio,
verificable con mock. El PR que no cumpla las cinco no entra.
