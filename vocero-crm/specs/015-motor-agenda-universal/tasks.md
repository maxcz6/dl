# Tasks: Motor de agendamiento universal (bandera + conectores)

**Input**: Design documents from `/specs/015-motor-agenda-universal/`

**Prerequisites**: plan.md, spec.md, research.md (D1..D10), data-model.md,
contracts/agenda.md, contracts/conector.md, quickstart.md. Constitución
**1.4.0** (enmienda de conectores ratificada 2026-08-26 — sin ella, US5/US6 no
existirían).

**Tests**: SÍ se incluyen — no son opcionales en este repo: la Constitución V
exige verificación y la IX el self-test de comportamiento contra la app viva;
SC-006/SC-007 los piden por nombre. La rama `004-motor-agenda` es **cantera**:
varios módulos y tests se portan de ahí adaptados (research D10) — portar ≠
copiar: cada task lo dice cuando aplica.

**Organization**: por historia de usuario (US1..US6 del spec), cada fase es un
incremento independiente verificable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizable (archivos distintos, sin dependencia pendiente)
- **[Story]**: historia a la que pertenece (US1..US6)
- Rutas exactas en cada descripción (proyecto único: `src/`, `tests/`, raíz)

---

## Phase 1: Setup (infraestructura compartida)

**Purpose**: esquema, migración y variables — la estructura idéntica en todas
las instancias (ADR-001).

- [X] T001 Agregar las cinco tablas de data-model.md (`calendar_settings`,
      `booking`, `offered_slot`, `zoom_credentials`, `google_credentials`) a
      `src/lib/db/schema.ts`, con columnas, FKs, índices y comentarios de
      intención (por qué `meeting_link`/`connector` se copian en la cita)
- [X] T002 [P] Registrar los prefijos de id `cal_`, `bk_`, `ofs_`, `zcred_`,
      `gcred_` en `src/lib/db/ids.ts`
- [X] T003 [P] Declarar `AGENDA`, `ZOOM_BASE_URL`, `ZOOM_OAUTH_BASE_URL`,
      `GOOGLE_CAL_BASE_URL`, `GOOGLE_OAUTH_BASE_URL` en el esquema zod de
      `src/lib/env.ts` (opcionales, defaults reales; NO `process.env` directo —
      no repetir la inconsistencia de `IG_GRAPH_BASE_URL`) y documentarlas en
      `.env.example` con guía inline (`AGENDA` apagada por defecto)
- [X] T004 Generar `drizzle/0009_motor_agenda.sql` con `pnpm db:generate` y
      editarla a mano para que sea re-ejecutable (`IF NOT EXISTS`, FKs en
      DO-blocks) e incluya el índice **UNIQUE parcial**
      `booking_org_active_slot_uq (organization_id, scheduled_at) WHERE status
      IN ('agendada','realizada') AND is_test = false` (drizzle-kit no emite el
      predicado — copiar el patrón del 0002 de la cantera); verificar doble
      aplicación idempotente con `pnpm db:migrate`

---

## Phase 2: Foundational (bloqueante para TODAS las historias)

**Purpose**: los módulos puros que cada historia consume.

**⚠️ CRITICAL**: ninguna historia arranca sin esta fase completa.

- [X] T005 [P] Portar de la cantera los helpers puros de tiempo a
      `src/lib/time/slots.ts` (`Intl`, sin dependencias: expandir horario de
      pared a UTC, día de semana en zona, etiquetas es-MX con día en palabras,
      `overlaps` fin-exclusivo) — research D1
- [X] T006 [P] Portar `tests/unit/slots.test.ts` (DST Nueva York/Madrid/México,
      hora inexistente y ambigua, franjas partidas)
- [X] T007 Crear `src/server/agenda/settings.ts`: tipos + defaults (L-V
      09:00-18:00, 30 min, aviso 2 h, ventana 7 días, `enlace-fijo`) +
      get/upsert con clamps, validación de timezone contra el runtime (422) y
      de `connector` contra el catálogo
- [X] T008 Crear `src/server/agenda/availability.ts`:
      `computeAvailability` (horario − citas activas − bloqueos, aviso mínimo,
      ventana) y `findSlot` (re-validación acotada ±1 día, coincidencia por
      epoch exacto, `excludeBookingId` para reprogramar) — portado de la
      cantera; ocupan agenda solo `agendada`/`realizada` reales
- [X] T009 Crear `src/server/agenda/spread.ts`: reparto de huecos por día
      (`perDay`/`days`) con `dayIso`/`dayLabel`/`time` — patrón del fork,
      incidente 2026-08-07 (el catálogo es más ancho que el menú)
- [X] T010 [P] Crear `tests/unit/availability.test.ts` (franja partida, aviso
      mínimo, respiro, ventana, bloqueo oculta, cancelada libera, reparto por
      día)
- [X] T011 [P] Crear `src/server/agenda/connectors/types.ts` con el contrato
      exacto de contracts/conector.md (4 operaciones + `ConnectorCapabilities`)
- [X] T012 Crear `src/server/agenda/connectors/enlace-fijo.ts` (createMeeting →
      link de settings o null; update/delete no-op; test siempre ok) y el
      catálogo `src/server/agenda/connectors/index.ts` (registro por id, el
      motor pregunta capacidades — molde de `src/server/channels/capabilities.ts`)

**Checkpoint**: motor puro calculable y testeable sin app viva.

---

## Phase 3: User Story 1 — La instancia decide si la agenda existe (P1) 🎯

**Goal**: la bandera `AGENDA` y su plomería, con CI probando ambas
configuraciones (FR-001, FR-021).

**Independent Test**: unit de parseo en verde; con bandera ausente la app se ve
y se comporta EXACTAMENTE como hoy; matriz de CI verde en las dos
configuraciones.

- [X] T013 [US1] Crear `src/server/agenda/flag.ts`: `agendaEnabled()` (acepta
      `on`/`1`/`true`, tolerante a mayúsculas/espacios; cualquier otra cosa =
      apagada) y `agendaDisabledResponse()` → 404 con el razonamiento de
      ADR-001 ("el endpoint no existe en esta instancia") — molde de
      `src/server/channels/enabled.ts`
- [X] T014 [P] [US1] Crear `tests/unit/agenda-flag.test.ts` (ausente, `on`,
      valores raros, mayúsculas) — molde de `tests/unit/channels.test.ts`
- [X] T015 [US1] En `src/app/(app)/layout.tsx` calcular `agendaEnabled()` en el
      servidor y pasarlo por prop a través de `AppShell` hasta `AppNav`
      (patrón server-calcula→prop de `inbox/page.tsx`; los navs NO leen env)
- [X] T016 [US1] En `src/components/app-nav.tsx` y
      `src/components/settings/settings-nav.tsx` aceptar la prop de bandera
      (default apagada) SIN agregar entradas aún: con la prop ausente el render
      actual queda byte a byte idéntico
- [X] T017 [US1] En `src/app/(app)/settings/layout.tsx` (server component)
      calcular la bandera y pasarla a `SettingsNav`
- [X] T018 [US1] En `.github/workflows/ci.yml` agregar la matriz de dos
      configuraciones al job `gates`: `default` (sin `CHANNELS` ni `AGENDA`) y
      `completo` (`CHANNELS=whatsapp,instagram`, `AGENDA=on`) — paga la deuda
      que ADR-001 prometió y nunca implementó

**Checkpoint**: bandera operativa y verificada; nada visible cambió para una
instancia default.

---

## Phase 4: User Story 2 — El negocio define cuándo atiende y cómo se entrega la reunión (P1)

**Goal**: Ajustes → Agenda completo con el conector `enlace-fijo` (FR-002,
FR-003, FR-004).

**Independent Test**: escenarios 1-3 y 6 de US2 del spec: defaults con 200,
huecos correctos con etiqueta con día, DST correcto, enlace fijo opcional.

- [X] T019 [US2] Crear `src/app/api/calendar/settings/route.ts` GET/PUT según
      contracts/agenda.md (primera línea: `agendaDisabledResponse()` si la
      bandera está apagada; zod; clamps; 422 por timezone/connector inválidos;
      jamás credenciales en la respuesta)
- [X] T020 [US2] Crear `src/app/api/calendar/availability/route.ts` GET
      (`from`/`to`, vista del operador, NO registra oferta, `{"slots":[]}` con
      200 cuando no hay)
- [X] T021 [US2] Crear `src/app/(app)/settings/calendar/page.tsx` +
      `src/components/settings/agenda-client.tsx`: editor de horario semanal,
      duración/respiro/aviso/ventana, zona horaria, selector de conector desde
      el catálogo (con sus capacidades como descripción), campo de enlace fijo,
      y aviso visible si se elige un conector externo sin credenciales
      configuradas
- [X] T022 [US2] Agregar la pestaña "Agenda" (`/settings/calendar`) a `TABS` en
      `src/components/settings/settings-nav.tsx`, renderizada solo con la prop
      de bandera encendida (T016)
- [X] T023 [US2] Crear el guion `tests/e2e/us-agenda.md` (historias US1+US2) y
      la sección "agenda: bandera y ajustes" en `scripts/e2e-selftest.mjs`:
      settings/availability → 404 con bandera apagada; defaults 200; guardar
      horario; huecos dentro de franja con etiqueta con día; enlace fijo vacío
      se acepta

**Checkpoint**: un negocio configura su agenda de punta a punta sin terceros
(SC-002).

---

## Phase 5: User Story 3 — Quien conduce la conversación ofrece y reserva (P1)

**Goal**: el corazón — las dos garantías innegociables + superficie de bot +
acciones del agente (FR-005..FR-012).

**Independent Test**: escenarios 1-8 de US3: 201 exacto, `slot_not_offered`,
carrera → `slot_taken` con alternativas frescas, reprogramación por bot,
sandbox, agente incluido.

- [X] T024 [US3] Crear `src/server/agenda/offers.ts`: reemplazo completo
      transaccional de `offered_slot` por conversación, lectura y limpieza
      (portado de la cantera)
- [X] T025 [P] [US3] Crear `tests/unit/offers.test.ts` (reemplazo, limpieza al
      reservar, cascade con la conversación)
- [X] T026 [US3] Crear `src/server/agenda/service.ts` —
      `createSessionBooking`: exige instante ofrecido a ESA conversación (epoch
      exacto → `slot_not_offered` + lo ofrecido); re-valida con `findSlot` →
      `slot_taken` + alternativas frescas re-registradas como nueva oferta;
      INSERT capturando `23505` → `slot_taken` (research D7); copia
      `connector`/`meeting_link` vigentes; efecto `createMeeting` best-effort
      DESPUÉS de escribir (fallo ⇒ `link_pending=true`; error de auth ⇒ marcar
      credencial en error); **aserción `is_test` ANTES de la bifurcación por
      conector**; avance del lead solo-adelante por la puerta única
      `src/server/leads/stage-history.ts` en try/catch (un fallo no impide la
      cita); etiqueta con día en palabras
- [X] T027 [US3] Completar `src/server/agenda/service.ts` — reprogramar
      (excluye la propia cita; `updateMeeting` sobre el MISMO `external_ref`,
      conserva link; `reminder` no aplica: fuera de v1), cancelar (idempotente;
      `deleteMeeting` con 404=éxito; cancelada no se reprograma → 422), marcar
      realizada/no_show, y crear bloqueos — el guard de `is_test` simétrico en
      las TRES mutaciones (FR-017)
- [X] T028 [P] [US3] Crear `tests/unit/booking-race.test.ts`: dos confirmaciones
      del mismo instante — una gana, la otra recibe `slot_taken` mapeado del
      unique-violation; jamás dos citas activas reales en el mismo epoch
- [X] T029 [US3] Crear `src/app/api/bot/availability/route.ts`: bandera→404,
      `requireBotKey`, registra la oferta (T024), clamps `limit` 1-48 default
      12 / `perDay` 1-8 / `days` 1-14, respuesta con `diasConAgenda`
      (contracts/agenda.md); `export const dynamic = "force-dynamic"`
- [X] T030 [US3] Crear `src/app/api/bot/bookings/route.ts`: POST → **201**
      `{bookingId, meetingLink, linkPending, label}` / 409 con sobre ANIDADO +
      `slots` hermano / 404 / 422; PATCH → **200** reprograma la próxima cita
      activa de la conversación bajo las mismas reglas de oferta (sin cancel:
      esa la decide el dueño — handoff)
- [X] T031 [US3] Extender `tests/unit/bot-gateway.test.ts`: 404 con bandera
      apagada, 401 sin llave, y la FORMA exacta de 201/409 (los mocks del fork
      divergieron del contrato real y costó un outage — research D9)
- [X] T032 [US3] Agregar `offer_slots {reply?}` y `book_slot {startUtc, reply?}`
      a la unión de `src/server/ai/actions.ts` SOLO con bandera encendida, la
      sección condicional del prompt en `src/server/ai/prompts.ts` (apagada = 0
      tokens) y la ejecución en `src/server/ai/pipeline.ts` con degradación (el
      motor adjunta las etiquetas reales; `startUtc` no ofrecido se rechaza y
      re-ofrece; fallo del motor → responde sin agendar, jamás tumba el turno)
- [X] T033 [US3] Sección "agenda: garantías" en `scripts/e2e-selftest.mjs` +
      extender `tests/e2e/us-agenda.md`: feliz con enlace-fijo (201 exacto),
      `slot_not_offered`, carrera con `slot_taken` + reservar la alternativa de
      inmediato, repetido → 409, lead avanza de etapa, Laboratorio agenda
      `is_test` sin efectos externos

**Checkpoint**: motor completo usable por bot externo y agente incluido —
**este es el MVP funcional** (SC-003, SC-004, SC-005 parciales).

---

## Phase 6: User Story 4 — El operador ve y maneja sus citas (P2)

**Goal**: la página "Citas" con ciclo de vida completo y reintento de enlace
(FR-009, FR-014, FR-015).

**Independent Test**: escenarios 1-5 de US4: listar, reprogramar libera hueco,
cancelar idempotente, bloquear, reintentar enlace (el e2e del reintento se
completa en US5, que introduce el primer conector que puede fallar).

- [X] T034 [US4] Crear `src/server/agenda/queries.ts`: listado con
      fecha/hora/día en zona del negocio, contacto, origen, estado, `connector`,
      `meetingLink`, `linkPending`, `isTest`
- [X] T035 [US4] Crear `src/app/api/bookings/route.ts` (GET; POST **201** con
      unión discriminada `session|block`, 409/422) y
      `src/app/api/bookings/[id]/route.ts` (PATCH
      `reschedule`/`cancel`/`status`/`retry_link` según contracts/agenda.md)
- [X] T036 [US4] Implementar `retry_link` en `src/server/agenda/service.ts`:
      re-invoca `createMeeting` contra el conector de ORIGEN de la cita
      (`booking.connector`, no el activo); éxito escribe
      `external_ref`/`meeting_link` y limpia `link_pending`; 422 si no había
      pendiente
- [X] T037 [US4] Crear `src/app/(app)/bookings/page.tsx` +
      `src/components/bookings/bookings-client.tsx`: lista, acciones
      (reprogramar con huecos disponibles, cancelar, realizada/no_show), crear
      bloqueo, distintivo de prueba, y botón "Reintentar enlace" cuando
      `linkPending`
- [X] T038 [US4] Agregar la entrada "Citas" (`/bookings`, icono de calendario
      de lucide-react) a `NAV` en `src/components/app-nav.tsx`, renderizada
      solo con la prop de bandera (T016)
- [X] T039 [US4] Sección "agenda: operador" en `scripts/e2e-selftest.mjs` +
      guion: listar tras agendar por bot, reprogramar libera el hueco anterior,
      cancelar dos veces sin fallo, bloqueo oculta huecos, cita de prueba
      marcada

**Checkpoint**: el operador confía en el motor — pipeline de citas visible y
manejable.

---

## Phase 7: User Story 5 — Conector Zoom (P2)

**Goal**: el conector de referencia, portado del fork con sus lecciones
(FR-013..FR-018, research D5).

**Independent Test**: escenarios 1-5 de US5 contra el zoom-mock: crear/mover/
borrar reunión, credencial inválida no persiste, 401 marca error visible,
scopes completos documentados.

- [X] T040 [US5] Crear `src/server/agenda/connectors/zoom.ts`: token S2S
      (`grant_type=account_credentials`, `Basic`), caché en memoria con
      expiración anticipada 60 s e invalidación al cambiar credenciales;
      `createMeeting` (`type:2`, start UTC sin milisegundos, settings
      `join_before_host`/sin waiting room), `updateMeeting` (mismo id ⇒ mismo
      link), `deleteMeeting` (404 tolerado), `testConnection` (`GET /users/me`);
      error de auth tipado para que el motor marque la credencial
- [X] T041 [US5] Crear `src/server/agenda/connectors/zoom-credentials.ts`:
      cifrado con `src/lib/crypto` (secret cipher/iv/tag), `last4`, upsert que
      invalida la caché de token, `markError` — y el estado `error` SE ESCRIBE
      (en el fork es un enum decorativo; research D5)
- [X] T042 [US5] Crear `src/app/api/settings/zoom/route.ts` (GET forma pública
      con `secretLast4`+`status`; PUT valida contra el proveedor ANTES de
      persistir → `422 zoom_invalid`; DELETE desconecta) y
      `src/app/api/settings/zoom/test/route.ts` (probar sin guardar) — bandera
      →404, molde de `/api/settings/whatsapp`
- [X] T043 [US5] Sección de credenciales Zoom en
      `src/components/settings/agenda-client.tsx`: tres campos, botón Probar,
      `…last4`, tarjeta roja de reconexión si `status="error"`, y la guía de
      los CUATRO scopes granulares incluido `user:read:user` (la guía del fork
      lo omite y la validación fallaría — research D5)
- [X] T044 [P] [US5] Crear el mock: `src/app/api/dev/zoom-mock/[...path]/route.ts`
      + `src/server/dev/zoom-mock-state.ts` tras `mockGuard()` (404 en
      producción): `oauth/token`, `users/me/meetings` CRUD, `users/me`,
      `_state`/`_reset`, y camino infeliz determinista (client secret terminado
      en `-invalid` → 400) — molde del zoom-mock del fork
- [X] T045 [US5] Crear `tests/unit/connectors.test.ts`: suite de contrato
      COMPARTIDA parametrizada por conector (enlace-fijo + zoom): las 4
      operaciones, 404-tolerancia del delete, y el mapeo fallo→`link_pending` /
      auth→`status error` en el servicio
- [X] T046 [US5] Sección "agenda: zoom" en `scripts/e2e-selftest.mjs` + guion:
      conectar (inválida → 422 sin persistir; válida → conectado), agendar crea
      reunión visible en `_state`, reprogramar conserva link, cancelar borra,
      **fallo al crear → 201 con `linkPending` → "Reintentar enlace" en la UI
      lo repara**, y sandbox: `_state` vacío tras una corrida del Laboratorio

**Checkpoint**: contrato de conectores validado con un proveedor real (SC-006
parcial).

---

## Phase 8: User Story 6 — Conector Google Calendar + Meet (P3)

**Goal**: evento en el calendario del dueño + link de Meet, sin SDK (research
D6). Recortable sin romper la feature.

**Independent Test**: escenarios 1-4 de US6 contra el google-mock; guía con la
advertencia de "En producción".

- [X] T047 [US6] Resolver el NEEDS VERIFICATION de research D6: confirmar
      (documentación oficial de Calendar API y, si hay credenciales de prueba,
      llamada real) si `events.insert` con `conferenceDataVersion=1` devuelve
      el link de Meet en la respuesta síncrona o exige releer el evento; fijar
      el contrato del adaptador y el comportamiento del mock según lo
      confirmado; registrar el hallazgo en
      `specs/015-motor-agenda-universal/research.md`
- [X] T048 [US6] Crear `src/server/agenda/connectors/google.ts`: refresh→access
      token (`oauth2.googleapis.com/token`) con caché; `createMeeting` (evento
      + `conferenceData.createRequest`), `updateMeeting` (patch de fechas),
      `deleteMeeting` (404 tolerado), `testConnection` (GET del calendario);
      scope `…/auth/calendar.events`
- [X] T049 [US6] Crear `src/server/agenda/connectors/google-credentials.ts`:
      DOS secretos cifrados (client secret + refresh token), `calendar_id`
      default `primary`, `last4`, `markError`
- [X] T050 [US6] Crear `src/app/api/settings/google/route.ts` + `test/route.ts`
      (mismo molde que Zoom; `422 google_invalid`)
- [X] T051 [US6] Sección de credenciales Google en
      `src/components/settings/agenda-client.tsx` con la advertencia en
      negritas: la app OAuth del negocio debe estar "En producción" — en
      "Testing" Google revoca el refresh token a los 7 días y la integración
      muere en silencio (research D6)
- [X] T052 [P] [US6] Crear el mock: `src/app/api/dev/google-mock/[...path]/route.ts`
      + `src/server/dev/google-mock-state.ts` (`token`, events CRUD con link de
      Meet según T047, `_state`/`_reset`, refresh token `-invalid` → 400
      `invalid_grant`)
- [X] T053 [US6] Extender `tests/unit/connectors.test.ts` con google + sección
      "agenda: google" en `scripts/e2e-selftest.mjs` + guion (conectar, evento
      creado/movido/borrado, token revocado → cita con `linkPending` +
      credencial en error visible)

**Checkpoint**: los tres conectores pasan la misma suite de contrato (SC-006).

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: la documentación que es PARTE del alcance (FR-022) y la
verificación final.

- [X] T054 [P] Crear `docs/agenda-conectores.md`: el contrato público, la guía
      "escribe tu conector" (los 6 archivos exactos que toca un fork y las 5
      condiciones constitucionales), scopes de Zoom y gotchas de Google —
      contenido base en contracts/conector.md
- [X] T055 [P] Crear `docs/adr-002-conectores-de-agenda.md`: bandera `AGENDA`
      hermana de `CHANNELS`, contrato de 4 operaciones, sin free-busy en v1, y
      el criterio de revisión (a la tercera bandera, conversación sobre una
      interfaz común — research D3)
- [X] T056 Reescribir en `README.md` la sección "Fuera de alcance a propósito"
      (el motor ENTRA al core tras ADR-001 y la constitución 1.4.0, con la
      respuesta a sus dos argumentos originales — sección "Qué cambió" del
      spec) y agregar "Agenda y conectores": la bandera, la conexión de Zoom y
      Google, y el enlace fijo
- [X] T057 [P] Actualizar `CLAUDE.md` (fila del mapa del código: agenda →
      `src/server/agenda/` + conectores; nota de la bandera) y
      `specs/README.md` (fila de `015` en la tabla de specs: ciclo completo)
- [X] T058 Corrida final: gate técnico (`pnpm typecheck && pnpm lint && pnpm
      build && pnpm test`) + `pnpm test:e2e` completo en LAS DOS
      configuraciones de la matriz + recorrido manual de
      `specs/015-motor-agenda-universal/quickstart.md`; lo intrínsecamente no
      automatizable (juicio visual de la UI) se marca pendiente de verificación
      humana (Constitución V/IX)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → historias en orden de prioridad →
  **Polish (9)**
- **US1 (3)**: tras Foundational. Sin dependencias de otras historias.
- **US2 (4)**: tras US1 (usa la plomería de props T015-T017) y Foundational
  (T007-T012).
- **US3 (5)**: tras Foundational + T013 (el guard de bandera de sus rutas) +
  T007/T008/T012 (settings, disponibilidad, conector default). No depende de
  US2 para funcionar (usa defaults), aunque US2 la vuelve configurable.
- **US4 (6)**: tras US3 (consume `service.ts` y las citas creadas).
- **US5 (7)**: tras US3 (los puntos de efecto en `service.ts`) y US2 (la
  pantalla donde viven las credenciales).
- **US6 (8)**: tras US5 (reusa molde de rutas/mock y la suite de contrato).
  T047/T048/T052 pueden avanzar en paralelo con el cierre de US5 si hay manos.
- **Polish (9)**: tras las historias que se decida entregar.

### Parallel Opportunities

- Setup: T002 ∥ T003 (T004 espera a T001+T002).
- Foundational: (T005→T006) ∥ (T011→T012) ∥ T010; T007-T009 tras T005.
- US1: T014 ∥ T015-T017; T018 en cualquier momento de la fase.
- US3: T025 ∥ T028 ∥ el resto una vez existan sus módulos.
- US5: T044 (mock) ∥ T040-T043 (adaptador/UI); ídem US6 con T052.
- Polish: T054 ∥ T055 ∥ T057.

---

## Implementation Strategy

**MVP = Fases 1-5** (Setup + Foundational + US1 + US2 + US3): agendamiento
completo y garantizado con `enlace-fijo`, usable por el agente incluido y por
cualquier cerebro externo. **Recomendación antes de llamarlo producción**:
sumar US4 (sin la página "Citas" el operador no puede confiar en el motor —
rationale de US4 en el spec).

Entrega incremental: cada checkpoint es desplegable y se valida con su sección
del arnés antes de avanzar. US6 (Google) es la única historia recortable sin
tocar la promesa central; si se recorta, queda como primera aplicación de la
guía de forks.

**Regla transversal** (Constitución V/IX + CLAUDE.md): ninguna task se declara
Hecha sin el gate técnico en verde, y ninguna historia sin su sección del
self-test E2E corrida contra la app viva — camino feliz Y camino infeliz. Los
códigos HTTP se comparan EXACTOS (201/200/404/409/422), nunca `res.ok`.

## Notes

- La cantera (`git show 004-motor-agenda:<ruta>`) acelera T005-T008, T012,
  T024, T026-T028, T033 y el guion E2E — siempre adaptando a la capa de
  conectores y al main actual (research D10).
- Commit por task o grupo lógico, en la rama `015-motor-agenda-universal`.
- Evitar: tasks vagas, dos tasks [P] sobre el mismo archivo, dependencias
  cruzadas que rompan la independencia de las historias.
