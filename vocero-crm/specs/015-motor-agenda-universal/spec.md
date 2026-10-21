# Feature Specification: Motor de agendamiento universal (bandera + conectores)

**Feature Branch**: `015-motor-agenda-universal`

**Created**: 2026-08-26

**Status**: Draft — enmienda constitucional [ratificada y aplicada](./enmienda-constitucional.md) (constitución 1.4.0) y [tareas generadas](./tasks.md) (2026-08-26); lista para `/speckit-implement`

**Input**: Decisión del dueño 2026-08-26: "agregar a Vocero raíz el motor de
agendamiento con slots así como lo tengo en mi CRM, pero en modo bandera, tal
cual como lo hicimos con la multicanalidad de IG. Universal y compatible con
diversas apps de calendario —por ejemplo Zoom, Google Meet, Google Calendar—
sin pretender el 100%: si alguien tiene una no compatible, puede crear un fork
e implementarla. Esa capacidad de desarrollar los complementos faltantes es una
de las ventajas competitivas de Vocero."

## Contexto de negocio

Un negocio que atiende por WhatsApp convierte cuando **cierra una cita**. Hoy
Vocero lleva la conversación, califica y mueve el lead de etapa, pero la cita se
coordina a mano y fuera del sistema. Esta feature agrega el motor: el CRM sabe
cuándo está libre el negocio, ofrece esos huecos, acepta una reserva **solo**
sobre un hueco realmente ofrecido y libre, deja la cita registrada junto al
contacto y su conversación, y —si el negocio conectó un proveedor— **entrega la
reunión donde el negocio ya vive**: una reunión de Zoom por cita, o un evento en
su Google Calendar con link de Meet, o simplemente su sala fija de siempre.

### Qué cambió desde el intento 004 y el README

Esta decisión tiene historia y hay que decirla completa:

1. La rama local `004-motor-agenda` (2026-07-31, nunca mergeada) especificó el
   motor **sin ningún proveedor** —link fijo de texto— porque la Constitución II
   (Soberanía, endurecida) prohíbe dependencias externas nuevas. Sus dos
   garantías duras y su contrato sobreviven íntegros en este spec.
2. El `README.md` (§ "Fuera de alcance a propósito") declara hoy que el motor
   NO va al core, con dos argumentos: *(a)* "son unas mil líneas y una
   dependencia de fechas en un proyecto cuyo argumento es ser ligero", y *(b)*
   "el estado de qué huecos se ofrecieron pertenece a la conversación, o sea al
   agente, no al CRM".
3. La feature 014 (canal de Instagram) y el **ADR-001** cambiaron el terreno:
   lo opcional ya no se entrega en una rama ni en una skill que parchea — se
   entrega en el core, **apagado, detrás de una bandera**, con la migración
   siempre aplicada (inerte) y el peso pagado solo por quien la enciende.

Respuesta a los dos argumentos del README, que esta feature revierte por
escrito (el README se actualiza como parte del alcance):

- *(a) El peso*: detrás de la bandera `AGENDA` (apagada por defecto), una
  instancia que no agenda no ve rutas, ni navegación, ni acciones del agente,
  ni pide una sola credencial. Y el motor en sí sigue **sin dependencias
  nuevas** (la aritmética de zonas usa `Intl` de la plataforma — evidencia en
  `research.md` D1). El costo del que hablaba el README lo paga únicamente la
  instancia que enciende la bandera.
- *(b) Dónde vive "lo ofrecido"*: mantener esa memoria en el agente deja la
  garantía del lado del cliente — cualquier otro cerebro conectado por
  `/api/bot/*` (o el agente incluido) podría reservar un instante jamás
  ofrecido y el CRM lo aceptaría. Bajarla al core la vuelve **inviolable por
  construcción** y válida para todos los conductores por igual (research D2).
  El fork de agencia opera hoy con la garantía en el bot y funciona, pero solo
  porque hay un único cliente de confianza; Vocero promete "conecta TU propio
  cerebro", y una promesa así no puede depender de que todos los cerebros se
  porten bien.

### Lo genuinamente nuevo: conectores universales

Donde el 004 ponía un campo de texto y el fork de agencia una integración de
Zoom cableada a mano (`zoom_meeting_id` en la tabla, cliente propio, sin
abstracción), este spec introduce la **capa de conectores**: un contrato
público y pequeño —cuatro operaciones, medido del uso real en producción del
fork— que separa el motor (genérico, soberano) de la entrega de la reunión
(opcional, por proveedor). v1 trae tres conectores:

| Conector | Qué entrega | Dependencia externa |
|---|---|---|
| `enlace-fijo` | La sala fija del negocio, tal cual (comportamiento 004) | Ninguna |
| `zoom` | Una reunión de Zoom por cita (crear/actualizar/borrar) | Zoom API (S2S OAuth) |
| `google` | Un evento en el calendario del dueño + link de Meet | Google Calendar API |

Quien use otra tecnología (Teams, Outlook, CalDAV, Cal.com…) implementa el
contrato en su fork siguiendo la guía publicada — esa extensibilidad es parte
del producto, no un accidente.

**Puerta constitucional**: `zoom` y `google` violaban la lista cerrada del
Principio II de la constitución 1.3.0 (que además prohibía Google
nominalmente). La [enmienda](./enmienda-constitucional.md) (1.3.0 → 1.4.0) fue
**ratificada por el responsable y aplicada el 2026-08-26**: los conectores
opcionales son admisibles bajo cinco condiciones —apagados por defecto tras
bandera, aislados tras adaptador, instancia completa sin ellos con degradación
definida, credenciales cifradas del propio negocio, verificables en CI en ambas
configuraciones— y este diseño cumple las cinco.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La instancia decide si la agenda existe (Priority: P1)

Una instancia recién instalada no tiene agenda: ni página, ni pestaña de
ajustes, ni rutas, ni menciones en el prompt del agente. El operador que la
quiere la enciende con la bandera `AGENDA` en su despliegue — igual que
enciende el canal de Instagram con `CHANNELS`. Apagarla después no destruye
nada: los datos quedan, las superficies desaparecen.

**Why this priority**: es la condición del dueño ("en modo bandera, tal cual la
multicanalidad de IG") y lo que revierte el argumento del README: el peso lo
paga solo quien la enciende.

**Independent Test**: levantar la app sin `AGENDA`, verificar que las rutas de
agenda responden 404 y que la UI no la menciona; levantar con `AGENDA=on` y
verificar que todo aparece con defaults sensatos, sin pedir credenciales de
terceros.

**Acceptance Scenarios**:

1. **Given** una instancia sin `AGENDA` (o con valor no reconocido), **When**
   se piden `/api/calendar/*`, `/api/bookings*`, `/api/bot/availability` o
   `/api/bot/bookings`, **Then** todas responden **404** — el endpoint no
   existe en esta instancia, no hay nada que revelar (mismo criterio que el
   canal apagado de ADR-001).
2. **Given** la bandera apagada, **When** se navega la app, **Then** no
   aparecen "Citas" en la navegación ni "Agenda" en Ajustes, y el prompt del
   agente no contiene ninguna instrucción de agendamiento (cero costo de
   tokens).
3. **Given** la bandera encendida (`AGENDA=on`) en una instancia recién
   instalada, **When** se abre la app, **Then** aparecen "Citas" y Ajustes →
   "Agenda" con defaults sensatos y conector `enlace-fijo` — **sin** pedir
   ninguna credencial externa.
4. **Given** una instancia que usó la agenda y luego la apagó, **When**
   arranca, **Then** las citas y la configuración siguen en la base (la
   migración es inerte y nada se borra), y las superficies responden 404 hasta
   que vuelva a encenderse.
5. **Given** cualquier configuración de la bandera, **When** corre la
   migración al arranque, **Then** aplica siempre y es re-ejecutable: todas las
   instancias del mundo comparten la misma estructura (ADR-001).

---

### User Story 2 - El negocio define cuándo atiende y cómo se entrega la reunión (Priority: P1)

El operador abre Ajustes → Agenda y describe su realidad: qué días y en qué
franjas atiende, cuánto dura una cita, cuánto respiro deja entre citas, con
cuánta anticipación mínima acepta que le agenden, hasta cuántos días hacia
adelante abre su agenda, y su zona horaria. Y elige **cómo se entrega la
reunión**: su sala fija (pegar un link, cero dependencias), su cuenta de Zoom
(pegar las credenciales S2S de su propia app), o su Google Calendar (pegar las
credenciales de su propia app de Google). Las credenciales se validan contra el
proveedor **antes** de guardarse, se cifran en reposo y hacia afuera solo se
muestran sus últimos 4 caracteres.

**Why this priority**: sin esto no hay disponibilidad que ofrecer ni forma de
entrega; todo lo demás depende de esta pantalla.

**Independent Test**: configurar horario L-V 09:00-18:00 con citas de 30 min y
pedir la disponibilidad; verificar huecos dentro de la franja, en la zona
configurada, respetando el aviso mínimo. Conectar el conector Zoom contra el
mock y verificar que unas credenciales inválidas se rechazan sin guardarse.

**Acceptance Scenarios**:

1. **Given** una instancia recién encendida sin configuración, **When** se
   consulta la configuración, **Then** devuelve defaults sensatos (L-V
   09:00-18:00, cita de 30 min, sin respiro, aviso mínimo 2 h, ventana 7 días,
   conector `enlace-fijo` con link vacío) — 200, no 404.
2. **Given** el horario configurado, **When** se piden los huecos disponibles,
   **Then** solo vienen huecos futuros que cumplen el aviso mínimo, ordenados,
   cada uno con etiqueta legible en la zona del negocio que incluye el **día en
   palabras** (ej. "mié 5 ago, 10:00") — la etiqueta corta sin día ya agendó
   citas el día equivocado en producción del fork.
3. **Given** una zona horaria con cambio de horario de verano, **When** el
   rango cruza el cambio, **Then** las horas locales siguen siendo las
   configuradas y los instantes UTC son correctos.
4. **Given** el conector `zoom` seleccionado, **When** el operador pega
   credenciales inválidas y pulsa Probar/Guardar, **Then** se validan contra el
   proveedor y se rechazan con error claro **sin persistirse**; con
   credenciales válidas quedan cifradas y la UI muestra solo los últimos 4.
5. **Given** un conector configurado, **When** se consulta la configuración por
   API, **Then** ningún secreto viaja en la respuesta (solo `last4` y estado).
6. **Given** el conector `enlace-fijo` con el campo vacío, **When** se guarda,
   **Then** se acepta (es opcional): las reservas se crearán sin link.

---

### User Story 3 - Quien conduce la conversación ofrece y reserva (Priority: P1)

El agente de IA incluido, o un cerebro externo conectado por `/api/bot/*`,
ofrece al cliente horarios concretos y reserva el que eligió. El CRM garantiza
que **solo se reserva lo que se ofreció** y que **nunca se confirma una cita
que no se creó**. Al crearse la cita, el conector activo entrega la reunión
(link de Zoom/Meet o sala fija) y el lead avanza de etapa.

**Why this priority**: es la conversión del producto y donde viven los dos
fallos caros conocidos: prometer un horario que ya no existe, o confirmar una
cita que nunca se creó.

**Independent Test**: pedir horarios para una conversación, reservar uno
ofrecido y comprobar cita creada + hueco desaparecido; intentar reservar un
horario no ofrecido y comprobar el rechazo con la lista de lo que sí se
ofreció; simular la carrera (el hueco se ocupa entre oferta y elección) y
comprobar `slot_taken` con alternativas frescas y cero citas creadas.

**Acceptance Scenarios**:

1. **Given** una conversación activa, **When** se piden horarios para ofrecer,
   **Then** se devuelven huecos libres **repartidos entre días** (parámetros
   `limit`, `perDay`, `days`): el catálogo reservable es más ancho que el menú
   que se muestra — guardar solo lo mostrado dejó al agente del fork sin nada
   que ofrecer cuando el lead pedía otro día.
2. **Given** unos horarios ofrecidos, **When** se reserva uno de ellos,
   **Then** la cita queda creada, la respuesta es **201 Created** (no 200) con
   la etiqueta legible y el link de reunión (o `null`), y el hueco desaparece
   de la disponibilidad.
3. **Given** unos horarios ofrecidos, **When** se intenta reservar un instante
   que no estaba entre ellos —aunque esté libre—, **Then** se rechaza con
   `slot_not_offered` (la comparación es por **epoch exacto**, no por texto ni
   cercanía) y se devuelven los que sí se ofrecieron.
4. **Given** un horario que se ocupó entre la oferta y la elección, **When** se
   intenta reservar, **Then** responde `409 slot_taken` con **alternativas
   frescas ya registradas como nueva oferta**, y no se crea ninguna cita. Dos
   confirmaciones simultáneas sobre el mismo hueco: una gana, la otra recibe
   `slot_taken` — jamás dos citas activas en el mismo instante (garantía
   atómica en la base, no solo re-validación).
5. **Given** el conector `zoom` o `google` activo, **When** la reserva
   procede, **Then** la reunión se crea en el proveedor y su link viaja en la
   respuesta; **y given** el proveedor caído o con credenciales inválidas,
   **When** la reserva procede, **Then** la cita **se crea igual** con link
   pendiente (`linkPending: true`), la conversión nunca se pierde por un
   tercero caído, y quien confirma al cliente no promete un link que no tiene.
6. **Given** una cita activa del contacto, **When** quien conduce pide
   reprogramarla a otro hueco ofrecido, **Then** se mueve (200), el hueco
   anterior se libera y la reunión del proveedor se actualiza **conservando el
   mismo link**; mover una cita no exige pausar la IA ni un traspaso a humano.
7. **Given** una conversación del Laboratorio (`is_test`), **When** se reserva,
   **Then** la cita nace marcada de prueba y **jamás** llama al proveedor real
   — en crear, reprogramar y cancelar por igual.
8. **Given** el agente de IA incluido con la bandera encendida, **When**
   conduce una conversación, **Then** dispone de las acciones `offer_slots` y
   `book_slot` bajo las mismas reglas (el modelo no inventa horarios: el motor
   adjunta las etiquetas reales; un `startUtc` no ofrecido se rechaza y se
   re-ofrece), y un fallo del motor degrada el turno sin tumbarlo.

---

### User Story 4 - El operador ve y maneja sus citas (Priority: P2)

El operador entra a "Citas" y ve lo agendado —por él o por la IA— con la hora
en su zona, el contacto, el estado, el origen y el link. Desde ahí reprograma,
cancela, marca realizada o no-show, bloquea huecos para compromisos externos, y
si una cita quedó con el link pendiente (el proveedor falló al crear), lo
**reintenta** con un clic.

**Why this priority**: sin esta vista el operador no puede confiar en el motor,
y sin el reintento un hipo del proveedor sería una pérdida silenciosa (lección
del fork: hoy nadie repara una sesión que quedó sin reunión).

**Independent Test**: agendar por API, verla en la página, cancelarla desde ahí
y comprobar que el hueco vuelve a ofrecerse; forzar un fallo del conector
(mock), ver la cita marcada "sin enlace", reintentar y ver el link aparecer.

**Acceptance Scenarios**:

1. **Given** citas futuras y pasadas, **When** se abre "Citas", **Then** se
   listan con día y hora en la zona del negocio, contacto, origen (IA o
   manual), estado, link si existe, y marca visible de prueba cuando aplica.
2. **Given** una cita agendada, **When** se reprograma a otro hueco libre,
   **Then** queda a la nueva hora, el hueco anterior vuelve a ofrecerse y la
   reunión del proveedor se actualiza; **y** una cita cancelada no se
   reprograma (422).
3. **Given** una cita agendada, **When** se cancela, **Then** su hueco vuelve a
   ofrecerse, la cita queda como cancelada (no se borra) y la reunión del
   proveedor se borra (un 404 del proveedor cuenta como éxito). Cancelar dos
   veces no falla ni cambia nada.
4. **Given** un compromiso externo, **When** el operador bloquea ese rango,
   **Then** deja de ofrecerse aunque caiga dentro del horario de atención.
5. **Given** una cita con link pendiente, **When** el operador pulsa
   "Reintentar enlace", **Then** se reintenta contra el conector con el que
   nació la cita; si procede, el link queda guardado y visible.

---

### User Story 5 - Conector Zoom (Priority: P2)

El negocio que vive en Zoom pega en Ajustes las tres credenciales de su propia
app Server-to-Server (Account ID, Client ID, Client Secret) y desde entonces
cada cita crea su reunión de Zoom: reprogramar la mueve conservando el link,
cancelar la borra. Es el conector de referencia: su forma exacta lleva meses en
producción en el fork de agencia.

**Why this priority**: es el proveedor del dueño y el único con evidencia de
producción; valida el contrato de conectores con un caso real.

**Independent Test**: con el mock de Zoom, conectar credenciales, agendar y
verificar reunión creada con su `join_url`; reprogramar y verificar que el
proveedor recibió la actualización con el mismo id; cancelar y verificar el
borrado; credenciales inválidas → la conexión se rechaza sin guardarse.

**Acceptance Scenarios**:

1. **Given** credenciales S2S válidas, **When** se guardan, **Then** se validan
   primero contra el proveedor, quedan cifradas y el estado es "conectado".
2. **Given** el conector activo, **When** se crea una cita real, **Then** se
   crea una reunión programada con el tema, inicio, duración y zona del
   negocio, y `booking` guarda el id externo y el link.
3. **Given** una reunión creada, **When** la cita se reprograma, **Then** el
   proveedor recibe la actualización sobre el **mismo** id (el link no cambia);
   **When** se cancela, **Then** se borra en el proveedor (404 = ya no estaba:
   objetivo cumplido).
4. **Given** el proveedor respondiendo error de autenticación, **When** ocurre
   un efecto, **Then** la credencial pasa a estado de error visible en Ajustes
   (tarjeta de reconexión) — el estado de error existe para escribirse, no como
   enum decorativo (lección del fork, donde nunca se escribe).
5. **Given** la documentación del conector, **Then** lista TODOS los scopes
   necesarios, incluido el de lectura de usuario que usa la prueba de conexión
   (en el fork, la guía omite ese scope y la validación fallaría con
   credenciales por lo demás correctas).

---

### User Story 6 - Conector Google Calendar + Meet (Priority: P3)

El negocio que vive en Google pega las credenciales de su **propia** app de
Google Cloud (Client ID, Client Secret y un refresh token obtenido una sola
vez) y desde entonces cada cita crea un evento en su calendario con link de
Meet: su agenda personal y la del CRM cuentan la misma historia sin que el CRM
lea nada del calendario.

**Why this priority**: P3 porque no tiene evidencia de producción previa (a
diferencia de Zoom) y el motor + Zoom ya entregan la promesa completa; si se
recorta, la feature sigue siendo entregable.

**Independent Test**: con el mock de Google, conectar, agendar y verificar
evento creado con `conferenceData` (Meet); reprogramar → el evento se mueve;
cancelar → el evento se borra; refresh token inválido → error claro y estado de
reconexión.

**Acceptance Scenarios**:

1. **Given** credenciales de app propia válidas, **When** se guardan, **Then**
   se valida contra el proveedor antes de persistir, cifradas, últimos 4.
2. **Given** el conector activo, **When** se crea una cita real, **Then** se
   crea un evento en el calendario configurado (por defecto el principal) con
   petición de conferencia Meet, y el link de Meet viaja como link de la cita.
3. **Given** la guía de conexión, **Then** advierte explícitamente que la app
   OAuth del negocio debe estar en estado "En producción": en estado "Testing"
   Google revoca los refresh tokens a los 7 días y la integración moriría en
   silencio a la semana.
4. **Given** un refresh token revocado, **When** ocurre un efecto, **Then** la
   cita no se pierde (link pendiente), y la credencial queda en estado de error
   visible con instrucción de reconexión.

---

### Edge Cases

- **Sin horario configurado para hoy** (día cerrado): disponibilidad vacía, no
  error; lista vacía significa "ofrece otra salida" (handoff), no reintento.
- **Agenda llena**: `slots: []` con 200.
- **Conector sin configurar o enlace fijo vacío**: la reserva se crea con link
  `null`; nadie promete un link que no existe.
- **El proveedor falla al crear** (caído, 5xx, credencial inválida): la cita SE
  CREA con link pendiente; el operador reintenta desde "Citas". El fallo de un
  tercero jamás cuesta la conversión ni miente al cliente.
- **El negocio cambia de conector con citas futuras vivas**: cada cita
  recuerda el conector con el que nació; reprogramarla o cancelarla habla con
  ESE conector, no con el nuevo. Las citas nuevas usan el nuevo.
- **Credenciales borradas con citas futuras**: los efectos hacia el proveedor
  fallan best-effort (aviso, no bloqueo); la cita y su ciclo de vida en el CRM
  siguen intactos.
- **Instante inválido o en el pasado**: 422, sin crear nada.
- **Reserva sobre conversación inexistente**: 404.
- **Mensaje repetido del cliente** (reservar dos veces el mismo instante): la
  segunda recibe 409 — el hueco ya lo ocupa la primera; no hay duplicado.
- **Cambio de configuración con citas ya agendadas**: las citas existentes no
  se mueven; cada una conserva la duración con la que se creó.
- **Bandera apagada a media vida**: datos intactos, superficies 404 (ver US1).
- **Hora inexistente/ambigua por DST**: se resuelve a un instante real sin
  lanzar (documentado en research D1); las citas creadas nunca se mueven solas.

## Requirements *(mandatory)*

### Functional Requirements

**La bandera**

- **FR-001**: La agenda completa DEBE vivir detrás de la bandera de despliegue
  `AGENDA` (apagada por defecto), hermana de `CHANNELS` y bajo los mismos
  criterios de ADR-001: apagada ⇒ rutas de agenda (operador y bot) responden
  404, la UI no la menciona, el agente no recibe acciones ni prompt de agenda,
  y no se solicita ninguna variable ni credencial suya. La migración se aplica
  SIEMPRE (estructura idéntica en todas las instancias; apagada es inerte).
- **FR-002**: Encender la bandera NO DEBE exigir credenciales de terceros: el
  conector por defecto es `enlace-fijo` (cero dependencias externas). Los
  conectores externos son opt-in por configuración y credenciales del propio
  negocio.

**El motor (heredado del 004, innegociables intactos)**

- **FR-003**: Todos los instantes se guardan en UTC; el horario semanal es hora
  de pared en la zona del negocio; el DST se resuelve correctamente sin
  dependencias nuevas de fechas.
- **FR-004**: La disponibilidad DEBE calcularse como: horario semanal − citas
  activas − bloqueos manuales, en huecos de la duración configurada avanzando
  duración + respiro, descartando lo anterior a "ahora + aviso mínimo" y lo
  posterior a la ventana máxima. La disponibilidad NO lee calendarios externos
  (limitación aceptada y documentada; los compromisos externos se reflejan con
  bloqueos manuales).
- **FR-005 (INNEGOCIABLE)**: Una reserva pedida por quien conduce la
  conversación DEBE aceptarse solo si ese instante exacto figura entre los
  ofrecidos a ESA conversación (comparación por epoch exacto). Un instante
  libre pero no ofrecido se rechaza con `slot_not_offered` + la lista de lo
  ofrecido. Los ofrecidos se guardan en el core, por conversación, con
  reemplazo completo por oferta nueva y limpieza al reservar.
- **FR-006 (INNEGOCIABLE)**: Al confirmar, el sistema DEBE re-validar que el
  hueco sigue libre y garantizar atomicidad en la base: ante confirmaciones
  concurrentes solo una gana; la otra recibe `409 slot_taken` con alternativas
  frescas ya registradas como nueva oferta, y ninguna cita se crea para ella.
  Nunca se confirma una reserva que no se creó.
- **FR-007**: La creación de cita DEBE responder **201 Created** (no 200), y
  los códigos y la forma exacta del sobre de error (`{"error":{code,message}}`
  anidado, con `slots` como hermano en los 409) son **contrato verificado por
  el arnés E2E comparando códigos exactos** — en el fork, un cliente que solo
  aceptaba 200 dejó a todos los leads sin agendar, y un mock con el sobre plano
  ocultó el camino de re-oferta durante semanas.
- **FR-008**: La oferta de horarios DEBE poder repartirse entre días
  (`limit`/`perDay`/`days`) y toda etiqueta DEBE incluir el día en palabras
  además de la hora.
- **FR-009**: Una cita liga contacto (obligatorio en citas), y cuando existan,
  conversación y lead; captura la duración vigente al crearse y su origen (IA o
  manual). Estados: agendada → realizada / no_show / cancelada; cancelar es
  idempotente; cancelar o reprogramar libera el hueco; una cancelada no se
  reprograma. Los bloqueos manuales ocupan agenda sin contacto.
- **FR-010**: Quien conduce la conversación DEBE poder reprogramar la próxima
  cita activa de la conversación por la superficie de servicio (200, no 201),
  bajo las mismas garantías de oferta; mover una cita no exige traspaso a
  humano. Cancelar por esa superficie queda FUERA de v1 (esa la decide el
  dueño: handoff).
- **FR-011**: Al crear una cita para un contacto con lead, el lead avanza de
  etapa solo hacia adelante, por la puerta única de historial de etapas
  existente; un fallo del avance no impide la cita.
- **FR-012**: El agente de IA incluido DEBE ofrecer y reservar con acciones
  propias (`offer_slots`, `book_slot`) bajo las mismas reglas del motor,
  registradas SOLO con la bandera encendida; el modelo no redacta horarios: el
  motor adjunta las etiquetas reales. Un fallo del motor degrada el turno sin
  tumbarlo.

**Los conectores (lo nuevo)**

- **FR-013**: DEBE existir un contrato público de conector con exactamente las
  operaciones que el uso real exige: crear reunión, actualizar reunión, borrar
  reunión y probar conexión — más una declaración de capacidades. Leer
  disponibilidad ajena (free/busy) NO es parte del contrato v1. El contrato y
  la guía "escribe tu conector" se publican en `docs/` como parte del alcance.
- **FR-014**: Todos los efectos hacia el proveedor son **best-effort y
  posteriores a la verdad del CRM**: la cita se crea/mueve/cancela en el CRM
  aunque el proveedor falle. Un fallo al crear deja la cita con link pendiente,
  visible en "Citas" y reintentable manualmente contra el conector de origen.
- **FR-015**: Cada cita registra el conector con el que nació y su referencia
  externa; reprogramar y cancelar usan ese conector aunque el negocio haya
  cambiado el activo.
- **FR-016**: Las credenciales de conector viven cifradas en reposo (mismo
  mecanismo AES-256-GCM del repo, tabla explícita por proveedor — no un jsonb
  genérico), se validan contra el proveedor ANTES de persistirse, nunca viajan
  al cliente (solo últimos 4 + estado), y un error de autenticación detectado
  en un efecto DEBE escribir el estado de error y mostrarse en Ajustes como
  tarjeta de reconexión.
- **FR-017**: Las citas de conversaciones `is_test` (Laboratorio) JAMÁS llaman
  al proveedor real — la aserción va ANTES de la bifurcación por conector y
  aplica simétricamente a crear, reprogramar y cancelar (en el fork la
  protección es asimétrica y accidental).
- **FR-018**: Cada conector externo DEBE tener su mock bajo el gate de
  desarrollo existente (404 incondicional en producción), con estado
  inspeccionable y camino infeliz simulable, para que el arnés E2E ejercite
  éxito, carrera y fallo sin tocar proveedores reales.

**Transversales**

- **FR-019**: Toda la superficie respeta el aislamiento por organización
  (tablas con `organization_id` NOT NULL org-first, acceso por la capa
  `scoped()`), y la superficie `/api/bot/*` exige la llave de API existente.
- **FR-020**: La feature NO introduce dependencias npm nuevas: los conectores
  hablan HTTP directo con adaptadores propios (mismo patrón que el cliente de
  Graph API), y las fechas usan `Intl` de la plataforma.
- **FR-021**: La CI DEBE correr los gates en al menos dos configuraciones:
  todo apagado (default) y todo encendido (`AGENDA=on` + canales) — la matriz
  que ADR-001 prometió y nunca se implementó se paga aquí.
- **FR-022**: El README DEBE actualizarse: la sección "Fuera de alcance a
  propósito" se reescribe explicando qué cambió (esta sección del spec), y se
  agregan la conexión de conectores y la bandera. La decisión de conectores
  queda registrada como ADR-002.

### Key Entities

- **Configuración de agenda**: una por negocio. Horario semanal (hora de
  pared), duración, respiro, aviso mínimo, ventana, zona horaria, conector
  activo y link fijo (para `enlace-fijo`).
- **Cita (booking)**: instante UTC, duración capturada, tipo (cita/bloqueo),
  estado, origen, contacto/conversación/lead, marca de prueba, notas, y la
  entrega: conector de origen, referencia externa, link y si está pendiente.
- **Horario ofrecido (offered_slot)**: instante ofrecido a una conversación,
  con su etiqueta y cuándo — la memoria que hace verificable FR-005.
- **Credencial de conector**: por proveedor y organización, forma fija
  conocida (tabla explícita), secretos cifrados, estado conectado/error.
- **Conector**: contrato de 4 operaciones + capacidades declaradas; catálogo
  en el código, extensible por fork.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una instancia default (sin bandera) no expone NINGUNA superficie
  de agenda: 0 rutas que respondan distinto de 404, 0 elementos de UI, 0 tokens
  de prompt del agente dedicados a agendar.
- **SC-002**: Con la bandera encendida y sin credenciales de terceros, un
  negocio pasa de "sin agenda" a "primer hueco ofrecible" configurando una sola
  pantalla, sin tocar base de datos ni variables adicionales.
- **SC-003**: Cero doble-agendamiento: ninguna secuencia de reservas
  concurrentes sobre el mismo hueco produce dos citas activas reales en el
  mismo instante — verificado con la carrera real contra la app viva, no solo
  con mocks unitarios.
- **SC-004**: Cero reservas fantasma y cero conversiones perdidas por
  terceros: no existe éxito sin cita, ni cita sin que el hueco desaparezca, y
  con el proveedor caído el 100% de las reservas válidas se crean (con link
  pendiente y reintento disponible).
- **SC-005**: El caso "se ocupó a media conversación" termina siempre con el
  cliente recibiendo alternativas concretas (verificado E2E con códigos y sobre
  exactos: 201, `409 slot_taken` anidado + `slots`).
- **SC-006**: Los tres conectores v1 pasan el mismo juego de pruebas de
  contrato (crear/actualizar/borrar/probar + fallo) contra sus mocks; agregar
  un conector nuevo toca únicamente los archivos listados en la guía (catálogo,
  adaptador, credenciales, mock, doc) y cero archivos del motor.
- **SC-007**: Gate técnico verde en las dos configuraciones de la matriz de CI,
  y el arnés `pnpm test:e2e` cubre bandera, garantías, carrera, link pendiente
  y sandbox, saliendo distinto de cero si algo falla.

## Assumptions

- **Un negocio = una agenda**: configuración por organización, no por usuario;
  múltiples calendarios por agente quedan fuera de v1.
- **Un conector activo a la vez**: la composición (Zoom + evento en Google a la
  vez) queda fuera; quien quiera ver sus reuniones de Zoom en su calendario usa
  la sincronización propia de Zoom, como hace hoy el dueño del fork.
- **Sin lectura de calendario externo (free/busy) en v1**: consecuencia
  aceptada de mantener las garantías locales y rápidas; los compromisos
  externos se reflejan con bloqueos manuales. El contrato v1 ni siquiera
  declara la operación — un fork puede extenderlo.
- **Sin recordatorios automáticos en v1**: el core no tiene infraestructura de
  cron; el fork los resuelve con una tarea programada externa y ese patrón
  queda documentado como candidato post-v1.
- **Google por refresh token de app propia** (pegado una vez), no flujo OAuth
  con redirect en el producto ni service accounts (crear Meet con service
  account exige delegación de dominio de Workspace — mataría el caso Gmail).
  La guía exige app en estado "En producción" (en "Testing" los refresh tokens
  caducan a los 7 días).
- **Los horarios ofrecidos no caducan por reloj**: la frescura la garantiza la
  re-validación al confirmar (FR-006).
- **La rama `004-motor-agenda` no se rebasea**: nació de un main 76 commits
  atrás y su migración colisiona de número — exactamente el costo que ADR-001
  predijo para las ramas. Se usa como cantera de código y de evidencia; la
  feature nace de main.
- **La enmienda constitucional (1.4.0) fue ratificada y aplicada el
  2026-08-26**; el plan B de recorte (bandera + motor + `enlace-fijo`) quedó
  sin efecto.
