# Fase 0 — Investigación y decisiones

Feature: `015-motor-agenda-universal` · Fecha: 2026-08-26

Cada decisión con su evidencia. Tres fuentes: la rama `004-motor-agenda` (el
motor ya diseñado y probado contra este repo, 2026-07-31), el fork de agencia
`aishia-crm` + `aishia-lead-bot` (la integración Zoom y el gateway del bot en
producción desde julio), y verificación externa donde se indica.

---

## D1. Zona horaria y DST con `Intl`, sin dependencias (heredada del 004)

**Decisión**: aritmética de zonas con `Intl.DateTimeFormat` (`formatToParts`)
en helpers puros. No se agrega luxon (lo que usa el fork).

**Evidencia** (prototipo del 004, corrido entonces también dentro del
contenedor de producción `node:22-alpine`): México ago/ene → 15:00Z ambos;
Nueva York 2026-03-07 (EST) → 14:00Z y 2026-03-09 (EDT) → 13:00Z; Madrid CET
08:00Z / CEST 07:00Z; 418 zonas disponibles en el ICU del contenedor y formato
es-MX correcto. Bordes documentados: hora inexistente (salto de primavera) se
resuelve con el offset previo; hora ambigua (retroceso) toma la primera
ocurrencia; ninguna lanza.

**Alternativas**: luxon (dependencia nueva de runtime en un core que no tiene
ninguna de fechas — rechazada, FR-020); guardar el horario en UTC (rompe con
DST: el negocio abre "a las 9" todo el año — incorrecta); `Temporal` (no
estable en el runtime objetivo — revisable).

---

## D2. La memoria de "lo ofrecido" vive en el core (heredada del 004, reforzada)

**Decisión**: tabla `offered_slot` y su validación en el core del CRM.
`GET /api/bot/availability` registra la oferta por conversación; reservar exige
coincidencia por **epoch exacto** con lo ofrecido a ESA conversación.

**Rationale**: en el fork la protección vive en el bot (tabla `offered_slots`
en la base del bot, `aishia-lead-bot/migrations/001_init.sql`, match por epoch
en `app/tools.py`). Funciona porque hay UN cliente de confianza. Vocero promete
"conecta tu propio cerebro": con la garantía en el cliente, cualquier otro
cerebro podría reservar un instante jamás ofrecido y el CRM lo aceptaría. En el
core es inviolable por construcción y vale igual para el agente in-process, el
bot externo y cualquier integración futura. Esto responde directamente al
argumento del README ("lo ofrecido pertenece al agente"): pertenecía al agente
mientras el CRM no ofrecía la garantía; al ofrecerla, es el CRM quien debe
poder probarla.

**Por qué epoch exacto**: un LLM alucina con facilidad un "martes a las 10" que
nunca se ofreció o desplaza la hora al re-escribir el ISO; la comparación
exacta convierte esa alucinación en un rechazo explícito con la lista de lo que
sí se ofreció. El fork registra además la frase textual de confirmación del
lead para auditar disputas — buena práctica del lado del cliente que la guía
del bot recomendará, sin ser contrato.

---

## D3. La bandera: `AGENDA`, hermana de `CHANNELS` (nueva)

**Decisión**: una variable de entorno booleana `AGENDA` (`on` = encendida;
ausente o cualquier otro valor = apagada), parseada junto al patrón de
`src/server/channels/enabled.ts`, con las mismas consecuencias de ADR-001:
apagada ⇒ 404 en toda la superficie, UI sin rastro, acciones del agente no
registradas, migración siempre aplicada.

**Alternativas consideradas**:
- *Reutilizar `CHANNELS`*: agendar no es un canal; mezclar taxonomías confunde
  el contrato de capacidades por canal. Rechazada.
- *Una lista `AGENDA_CONNECTORS="zoom,google"` como bandera doble* (módulo +
  allowlist de conectores por despliegue): la soberanía ya queda garantizada
  por el opt-in real —ningún código llama a un proveedor sin conector
  seleccionado Y credenciales pegadas—, así que la segunda bandera solo
  agregaría ceremonia. Rechazada; si algún operador necesita prohibir
  conectores a nivel de despliegue, es una extensión natural futura.
- *Un mecanismo genérico `FEATURES=`*: ADR-001 fija el criterio de revisión
  ("cuando haya del orden de quince banderas, extraer una interfaz"); hoy van
  dos. Prematuro. Rechazada — pero la decisión queda registrada en ADR-002
  para que la tercera bandera dispare la conversación.

**Deuda que esta feature paga**: ADR-001 afirma que "CI corre la suite con la
bandera apagada y encendida" y el workflow real no tiene matriz ni menciona
`CHANNELS` (verificado: un solo job `gates`). FR-021 implementa la matriz con
dos configuraciones extremas (todo apagado / todo encendido), cubriendo ambas
banderas de una vez.

**Hueco de 014 que esta feature no hereda**: no existe precedente de pestaña de
Ajustes ni navegación bajo bandera (014 nunca creó la pestaña de Instagram; los
navs son client components con arrays constantes). El patrón correcto ya existe
en el repo: server component calcula y pasa por prop (`inbox/page.tsx` →
`InboxClient`). Se replica desde los layouts de servidor hacia `AppNav` y
`SettingsNav`.

---

## D4. El contrato de conector: 4 operaciones, ni una más (nueva)

**Decisión**: el contrato público es

```
createMeeting(creds, {topic, startUtc, durationMinutes, timezone, notes?})
  → { externalId: string | null, joinUrl: string | null }
updateMeeting(creds, externalId, {startUtc, durationMinutes, timezone}) → void
deleteMeeting(creds, externalId) → void          // 404 del proveedor = éxito
testConnection(creds) → { ok: true, detail? } | { ok: false, error }
```

más capacidades declarativas (`perBookingLink`, `updatesMeeting`,
`writesCalendarEvent`) al estilo del contrato de canales
(`src/server/channels/capabilities.ts`): el motor pregunta, no sabe.

**Evidencia**: es exactamente la superficie que el fork usa en producción
(`aishia-crm/src/lib/zoom/index.ts`: `createMeeting`, `updateMeeting`,
`deleteMeeting`, `testConnection`) — ni una operación más en meses de uso real.
`deleteMeeting` que traga el 404 ("reunión ya borrada: objetivo cumplido") y
`updateMeeting` que conserva el `join_url` (mismo id ⇒ mismo link) son
comportamiento observado, no teoría.

**Lo que deliberadamente NO entra**: `getBusy`/free-busy (leer el calendario
ajeno para descontar disponibilidad). El fork nunca lo tuvo — decisión de
producto explícita de su spec 005 ("Zoom ya sincroniza con mi calendario; los
compromisos externos son bloqueos manuales") — y meterlo acoplaría la latencia
y los fallos del proveedor al camino caliente de la disponibilidad, que hoy es
una query + aritmética local. Se decide a propósito y queda como frontera de
extensión para forks (Assumptions del spec).

---

## D5. Zoom Server-to-Server como conector de referencia (nueva)

**Decisión**: portar el adaptador del fork tal cual en espíritu: token S2S
(`POST {oauth}/oauth/token?grant_type=account_credentials&account_id=…`, header
`Basic base64(clientId:clientSecret)`), caché de token en memoria por proceso
con expiración anticipada 60 s e invalidación al cambiar credenciales;
`POST /users/me/meetings` con `type: 2`, topic, `start_time` UTC sin
milisegundos, `duration`, `timezone` y `settings {join_before_host: true,
waiting_room: false}`; `PATCH /meetings/{id}` solo con inicio/duración/zona;
`DELETE /meetings/{id}` tolerante a 404. Bases URL configurables solo para
apuntar al mock en self-test.

**Correcciones sobre el fork** (lecciones, no copias):
1. La guía de scopes del fork omite el de lectura de usuario que usa
   `testConnection` (`GET /users/me`): con solo `meeting:write:*` la conexión
   fallaría con credenciales por lo demás válidas. La guía v1 lista los cuatro
   scopes granulares (crear/actualizar/borrar reunión + leer usuario).
2. `isAuthError` existe en el fork y nadie lo consume, y el estado `error` de
   sus credenciales nunca se escribe. Aquí el error de autenticación en un
   efecto ESCRIBE el estado y la UI lo muestra (FR-016) — el criterio es
   estricto (401), no "cualquier 400" como el helper muerto del fork.
3. El fallo del proveedor en el fork es pérdida silenciosa (warn y nada más).
   Aquí deja `link_pending` visible y reintentable (FR-014, D8).

---

## D6. Google: Calendar + Meet con refresh token de app propia (nueva)

**Decisión**: el conector `google` habla REST directo (sin SDK):
`POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`) para
obtener el access token, y `POST/PATCH/DELETE …/calendars/{id}/events` con
`conferenceDataVersion=1` y `conferenceData.createRequest` para el link de
Meet. Credenciales: Client ID + Client Secret + refresh token de la **propia
app de Google Cloud del negocio**, pegados una vez; calendario destino
configurable (default `primary`). Scope: `…/auth/calendar.events`.

**Por qué así y no de otra forma** (verificado 2026-08-26):
- *Service account*: crear conferencias de Meet vía `conferenceData` con
  service account requiere delegación de dominio de Workspace; sin ella el
  proveedor rechaza la conferencia. Eso excluye a todo negocio con Gmail de
  consumidor — inaceptable para el público de Vocero. Fuentes:
  [issue #2387 de google-api-nodejs-client](https://github.com/googleapis/google-api-nodejs-client/issues/2387),
  [guía de dominio de Calendar API](https://developers.google.com/workspace/calendar/api/concepts/domain).
- *Flujo OAuth con redirect dentro del producto*: mejor UX, pero exige
  implementar callback, estado y rotación — más superficie para v1 sin cambiar
  la soberanía (la app OAuth seguiría siendo del negocio). Queda como mejora
  futura explícita.
- *Gotcha que la guía DEBE advertir*: con la app OAuth en publishing status
  "Testing" (tipo External), Google revoca autorizaciones y refresh tokens a
  los **7 días**; en "In production" no caducan. Sin esta advertencia la
  integración muere en silencio a la semana. Fuentes:
  [Google Cloud — Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en),
  [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2),
  [resumen del límite de 7 días](https://www.unipile.com/google-oauth-refresh-token/).
- **RESUELTO 2026-08-26 (era NEEDS VERIFICATION)**: la conferencia se crea de
  forma **asíncrona**. La documentación oficial es explícita: *"the immediate
  response to this call might not yet contain the fully-populated
  `conferenceData`; the status field contains `pending`"*, y solo cuando pasa a
  `success` aparecen los `entryPoints` con el enlace. Fuentes:
  [Create events — Calendar API](https://developers.google.com/workspace/calendar/api/guides/create-events)
  y la [referencia de events](https://developers.google.com/workspace/calendar/api/v3/reference/events).

  **Consecuencias de diseño, ya aplicadas:**
  1. El adaptador **re-lee el evento** unas pocas veces tras crearlo, en vez de
     confiar en la respuesta del insert.
  2. Si aun así sigue pendiente, la cita se entrega **con el evento creado y
     sin enlace** (`link_pending`), no se descarta ni se reintenta a ciegas.
  3. Eso obligó a una operación **opcional** más en el contrato:
     `refreshMeeting(creds, externalId)`. Sin ella, "Reintentar enlace" sobre
     una cita que ya tiene evento crearía un evento DUPLICADO en el calendario
     del dueño. Es opcional: un conector cuyo enlace llega de inmediato (Zoom)
     no la necesita.

  Esto es exactamente lo que el marcador de trazabilidad existía para evitar:
  fijar el contrato sobre un supuesto cómodo y descubrir en producción que el
  proveedor no lo cumple.

---

## D7. La carrera del slot: índice UNIQUE parcial + mapeo del 23505 (heredada del 004)

**Decisión**: además de la re-validación al confirmar, la atomicidad la da la
base: índice único parcial sobre `(organization_id, scheduled_at)` limitado a
`status IN ('agendada','realizada') AND is_test = false`; la violación (23505)
se mapea a `409 slot_taken` con alternativas frescas.

**Evidencia**: así lo implementó la rama 004 (migración `0002_grey_oracle.sql`,
índice `booking_org_active_slot_uq` + `isUniqueViolation` en el servicio) y su
E2E condujo la carrera contra la app viva. El contraste importa: el CRM del
fork en producción NO tiene este candado (verificado: sus únicas constraints de
`booking` son FKs; el patrón es leer-luego-insertar) — funciona por
serialización de facto de un solo operador, no por garantía. Vocero, con
cerebros externos concurrentes, necesita la garantía real. Solo instantes de la
rejilla son reservables (la coincidencia por epoch exacto con la
disponibilidad), así que la colisión práctica es "mismo instante", que el
índice cubre; el solape entre duraciones distintas lo filtra el cálculo de
disponibilidad en la oferta y la re-validación al confirmar.

---

## D8. Fallo del conector ⇒ cita con link pendiente, reintento manual (nueva)

**Decisión**: los efectos hacia el proveedor corren DESPUÉS de que la verdad
del CRM está escrita, son best-effort, y el fallo al crear deja
`link_pending = true` visible en "Citas" con acción "Reintentar enlace" (contra
el conector de origen). Sin cola ni cron en v1.

**Rationale**: la conversión jamás se pierde por un tercero caído (la lección
cara del fork es doble: el incidente del token de Meta 2026-08-03 —un hipo
externo tumbó los envíos— y la pérdida silenciosa actual de reuniones Zoom sin
reparación posible). La alternativa de una cola durable con reintentos
automáticos (patrón `pending_send` del bot del fork) es más robusta pero exige
un trabajador periódico que el core no tiene (Constitución II: sin colas
externas; el in-process no sobrevive reinicios). El reintento manual entrega el
90% del valor con el 10% de la maquinaria; la cola queda como evolución si la
práctica la pide.

**Regla de honestidad hacia el cliente**: cuando la respuesta trae
`meetingLink: null` + `linkPending: true`, quien confirma NO promete link
inmediato ("te llega el enlace por este medio"); el contrato lo dice y la guía
del agente/bot lo instruye.

---

## D9. Los códigos y el sobre son contrato verificado (heredada del fork, endurecida)

**Decisión**: `POST` de reserva → **201**; `PATCH` de reprogramación → 200;
errores SIEMPRE `{"error":{"code","message"}}` anidado, y en los 409 de agenda
`slots` como campo hermano. El arnés E2E compara códigos **exactos** (nunca
`res.ok`) y la forma del sobre.

**Evidencia** (los tres fallos reales del fork, todos invisibles hasta
producción): (1) el cliente del bot aceptaba solo 200 y el CRM respondía 201 —
ningún lead pudo agendar hasta encontrarlo, y los mocks daban 200; (2) los
mocks usaban el sobre plano `{"code"…}` y el CRM el anidado — todo 409 se leyó
como conflicto genérico y el camino de re-oferta jamás se activó; (3) motivos
de handoff libres → 422 por enum. La lección transversal: los mocks del
cliente divergieron del contrato real en código y forma, y por eso aquí el
contrato escribe ambos y el arnés los verifica contra la app viva.

---

## D10. Qué se hace con la rama `004-motor-agenda` (nueva)

**Decisión**: no se rebasea ni se renumera; se usa como **cantera**. La feature
nace de `main` con migración `0009`.

**Evidencia**: la rama quedó 76 commits atrás en 26 días; su migración
`0002_grey_oracle.sql` colisiona de número con el `0002` que main ganó después
(cadena de Drizzle lineal y hasheada); y 014 refactorizó `send.ts`,
`actions.ts` y `pipeline.ts` que la rama también toca. Es el caso empírico
exacto que ADR-001 predijo para "features en ramas" — y por eso se cita en el
spec como argumento, no solo como obstáculo. Lo que se rescata de la cantera:
helpers de tiempo con sus tests de DST, motor de disponibilidad, servicio de
reservas (incluido el mapeo 23505), acciones del agente, contrato y guion E2E —
adaptados al main de hoy y a la capa de conectores.
