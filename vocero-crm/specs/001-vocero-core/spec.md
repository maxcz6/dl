# Feature Specification: Vocero CRM — Núcleo v1 (001-vocero-core)

**Feature Branch**: `001-vocero-core`

**Created**: 2026-07-09

**Status**: Draft

**Input**: Vocero CRM: CRM de WhatsApp con agente de IA, open source (MIT), self-hosted y
gratuito, diseñado para que agencias de IA lo desplieguen en el VPS de sus clientes (una
instancia = un negocio). Incluye bandeja en tiempo real, contactos + pipeline kanban,
agente de IA configurable con knowledge base, Laboratorio de auto-evaluación del agente,
conexión del número de WhatsApp (directa o modo agencia), plantillas acotadas,
multi-usuario mínimo e instalación guiada en 15 minutos.

## Contexto de producto

- **Usuario primario**: la agencia de automatización/IA que implementa el CRM para un
  negocio cliente y lo extiende con herramientas de IA (el código debe ser legible y
  modificable; fronteras limpias, adaptadores, specs publicadas).
- **Usuario secundario**: el negocio que opera el CRM día a día (dueño y su equipo).
- **Una instancia = un negocio**: cada despliegue sirve a un solo negocio en su propio
  VPS/dominio. Sin billing, sin multi-tenant de plataforma.
- El repositorio será público (MIT) y un video será su instalador oficial; la calidad
  del texto en español neutro, los estados vacíos y la estética importan como features.
- Origen de patrones probados: **proyecto de referencia privado en producción** (se
  portan patrones, no se copia código ni diseño).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bandeja de WhatsApp en tiempo real (Priority: P1)

Como operador del negocio, veo todas las conversaciones de WhatsApp de mi número en una
bandeja de 3 columnas (lista de conversaciones / hilo de mensajes / panel del contacto),
donde los mensajes entrantes aparecen sin recargar la página, puedo responder texto, ver
el estado de mis mensajes (enviado/entregado/leído) y saber cuándo la ventana de 24 horas
está cerrada y qué hacer al respecto.

**Why this priority**: Sin bandeja funcional no hay CRM: es la superficie principal de
trabajo diario del negocio y el requisito de toda historia posterior.

**Independent Test**: Con el número conectado (o el entorno de pruebas interno), enviar
un mensaje entrante y verlo aparecer en la bandeja abierta en ≤2 segundos sin recargar;
responder desde el panel y ver el estado del mensaje progresar.

**Acceptance Scenarios**:

1. **Given** la bandeja abierta en el navegador, **When** llega un mensaje entrante de un
   número nuevo, **Then** la conversación aparece en la lista sin recargar la página en
   ≤2 segundos, con el nombre del perfil del remitente y el texto del mensaje.
2. **Given** una conversación abierta, **When** el operador escribe y envía una
   respuesta, **Then** el mensaje aparece en el hilo y su estado progresa
   (enviado → entregado → leído) conforme llegan las confirmaciones.
3. **Given** una conversación cuyo último mensaje entrante tiene más de 24 horas,
   **When** el operador la abre, **Then** el campo de texto está bloqueado con una
   explicación visible de la ventana de 24 horas y se le ofrece enviar una plantilla
   aprobada (ver US6).
4. **Given** la bandeja abierta y una interrupción breve de la conexión, **When** la
   conexión se restablece, **Then** la bandeja recupera los mensajes que llegaron durante
   el hueco sin intervención del usuario (reconexión con recuperación).
5. **Given** un mensaje entrante con contenido multimedia (imagen, audio, documento),
   **When** aparece en el hilo, **Then** se muestra un indicador del tipo de contenido
   (v1 no muestra el contenido multimedia completo).
6. **Given** cualquier contacto sin foto, **When** se muestra en lista/hilo/kanban,
   **Then** su avatar son sus iniciales sobre un color estable (siempre el mismo color
   para el mismo contacto).

---

### User Story 2 - Contactos y pipeline kanban (Priority: P1)

Como operador del negocio, cada persona que escribe queda registrada automáticamente
como contacto (con el nombre de su perfil, editable) y puedo organizar mis oportunidades
en un tablero kanban con etapas configurables, arrastrando tarjetas entre etapas, además
de buscar contactos, agregar notas y archivar de forma reversible.

**Why this priority**: Es la mitad "CRM" del producto: convierte conversaciones en un
pipeline de ventas operable.

**Independent Test**: Recibir un mensaje de un número nuevo → verificar que el contacto
y su lead existen; arrastrar la tarjeta a otra etapa → recargar → la posición persiste.

**Acceptance Scenarios**:

1. **Given** un mensaje entrante de un número desconocido, **When** se procesa, **Then**
   se crea el contacto con el nombre del perfil de WhatsApp (editable) y un lead en la
   primera etapa del pipeline.
2. **Given** el tablero kanban con las etapas sembradas (Nuevo → En conversación →
   Interesado → Cliente → Perdido), **When** el operador arrastra una tarjeta a otra
   etapa, **Then** el cambio persiste tras recargar la página.
3. **Given** una tarjeta del kanban, **When** el operador la observa, **Then** muestra
   contacto, última actividad y un enlace directo que abre su conversación en la bandeja.
4. **Given** las etapas configurables, **When** el operador las edita en configuración,
   **Then** puede renombrar/reordenar/agregar etapas, y las anclas "ganado" y "perdido"
   siguen existiendo.
5. **Given** la vista de lista de contactos, **When** el operador busca por nombre o
   teléfono, **Then** ve resultados filtrados; puede editar notas y archivar/desarchivar
   un contacto sin perder su historial.

---

### User Story 3 - Pestaña "Agente": comportamiento + knowledge base (Priority: P1)

Como negocio, configuro un agente de IA con nombre, tono, instrucciones, reglas de
escalado y saludo, y le doy conocimiento (pares pregunta/respuesta y bloques de texto
libre). El agente responde a los clientes con ese comportamiento y conocimiento,
actualiza el lead, lo mueve de etapa cuando corresponde, y escala a un humano cuando el
cliente lo pide, cuando el propio agente lo decide, o cuando hay un error o la ventana
está cerrada.

**Why this priority**: El agente de IA es el diferenciador del producto y el motor de
conversión; sin él, Vocero es solo una bandeja.

**Independent Test**: Con el proveedor de IA de prueba interno, enviar un mensaje
entrante y verificar que el agente responde con su configuración; enviar "quiero hablar
con un humano" y verificar el handoff (badge + IA silenciada).

**Acceptance Scenarios**:

1. **Given** el agente activado con comportamiento y KB configurados, **When** llega un
   mensaje entrante con una pregunta cubierta por el KB, **Then** el agente responde en
   la conversación con una respuesta marcada como generada por IA.
2. **Given** una conversación donde el cliente muestra intención de compra, **When** el
   agente lo detecta, **Then** puede mover el lead de etapa y/o actualizar sus datos, y
   el cambio se refleja en el kanban.
3. **Given** un cliente que escribe "quiero hablar con un humano" (o variantes de esa
   intención), **When** el agente procesa el mensaje, **Then** ocurre el handoff: la
   conversación muestra un badge visible, la IA queda silenciada en esa conversación y no
   vuelve a responder hasta que un humano la reactive.
4. **Given** la frase "somos 4 personas" en un mensaje, **When** se evalúa la detección
   de intención de escalado de respaldo, **Then** NO se dispara handoff (verificado con
   test unitario del patrón de respaldo).
5. **Given** el toggle global del agente apagado (o el toggle de una conversación),
   **When** llega un mensaje, **Then** el agente no responde en el ámbito apagado.
6. **Given** que NO hay proveedor de IA configurado, **When** el usuario abre las
   pestañas Agente o Laboratorio, **Then** ve un estado vacío explicativo ("Configura tu
   proveedor de IA…") con enlace a configuración y acciones deshabilitadas; el sistema
   jamás usa el proveedor de prueba interno como sustituto fuera de desarrollo.
7. **Given** el editor del knowledge base, **When** el contenido se acerca al límite de
   contexto del modelo, **Then** un contador de tamaño muestra un aviso (v1 inyecta el
   KB completo al prompt; el límite se documenta honestamente).
8. **Given** varios mensajes seguidos del mismo cliente en pocos segundos, **When** el
   agente procesa, **Then** responde UNA sola vez al conjunto (agrupación) y nunca
   procesa dos turnos simultáneos de la misma conversación (bloqueo por conversación).
9. **Given** un error del proveedor de IA o respuesta con formato inesperado, **When**
   ocurre en un turno, **Then** el sistema tolera el fallo (extracción robusta +
   reintentos) y un solo hipo del proveedor nunca tumba el turno ni marca error a la
   primera; si el fallo persiste, la conversación escala a humano (caso de error).

---

### User Story 4 - Laboratorio: el agente se prueba solo (Priority: P1)

Como agencia, antes de entregar la instancia (y después de cada cambio del knowledge
base) corro una evaluación automática donde 6 clientes simulados conversan contra el
agente real en un entorno interno que jamás toca WhatsApp, un juez independiente evalúa
cada conversación, y recibo un reporte con score, hallazgos con evidencia y sugerencias
que puedo aplicar con un click al knowledge base — y al re-correr veo si mejoré.

**Why this priority**: Es la pieza estelar y el diferenciador del producto: convierte
"espero que el bot funcione" en un ciclo medible de mejora.

**Independent Test**: Con el proveedor de IA de prueba interno: correr una evaluación →
verificar que las 6 conversaciones simuladas existen como conversaciones de prueba, que
ninguna tocó la API de WhatsApp, que el reporte muestra score y al menos un hallazgo con
sugerencia aplicable; aplicarla → re-correr → el historial muestra 2 corridas con delta.

**Acceptance Scenarios**:

1. **Given** la pestaña Laboratorio con proveedor de IA configurado, **When** el usuario
   pulsa "Correr evaluación", **Then** se lanza una corrida en segundo plano y la UI
   muestra el progreso sin bloquear la navegación.
2. **Given** una corrida en curso, **When** se ejecuta, **Then** 6 personas GUIONADAS
   fijas (comprador decidido, preguntón de precios, cliente enojado, pregunta fuera del
   knowledge base, pide un humano, escribe con errores y modismos) conversan
   secuencialmente contra el agente REAL (mismo pipeline de US3) en conversaciones
   marcadas de prueba; cada conversación termina al agotar su guion o al primer handoff.
3. **Given** el entorno de pruebas del Laboratorio, **When** cualquier conversación de
   prueba intenta enviar un mensaje real de WhatsApp, **Then** el envío es bloqueado por
   una aserción dura del sistema (excepción; cubierto por test unitario) — el Laboratorio
   es 100% interno y su UI lo declara de forma permanente ("Sandbox interno — no envía
   mensajes reales").
4. **Given** las 6 conversaciones terminadas, **When** el juez evalúa, **Then** hay
   exactamente UNA evaluación por conversación (6 por corrida) con veredicto
   verde/amarillo/rojo y hallazgos tipados (alucinación / fuera de KB / debió escalar /
   tono) con evidencia y sugerencia opcional.
5. **Given** la corrida completada, **When** el usuario abre el reporte, **Then** ve un
   score global 0–100 (% ponderado de conversaciones verdes), tarjetas de hallazgo con
   evidencia, y sugerencias aplicables con un click que pre-llenan una entrada del KB
   para editar y guardar.
6. **Given** una sugerencia aplicada al KB, **When** el usuario re-corre la evaluación,
   **Then** el historial muestra ambas corridas con el delta de score respecto a la
   anterior.
7. **Given** una corrida en curso, **When** el usuario intenta lanzar otra, **Then** el
   sistema lo impide (máximo 1 corrida concurrente por organización).
8. **Given** una corrida que supera el tiempo máximo (10 minutos) o un reinicio del
   servidor con corridas activas, **When** ocurre, **Then** la corrida queda marcada como
   fallida — nunca "corriendo" para siempre.

---

### User Story 5 - Conexión del número: directa o modo agencia (Priority: P1)

Como agencia (o negocio directo), conecto el número de WhatsApp de la instancia desde un
wizard en Configuración → WhatsApp: pego WABA ID, Phone Number ID y token; el sistema
valida que el token corresponde al número antes de guardar (cifrado); y obtengo la URL
completa del webhook lista para copiar en el panel de Meta (modo directo) o para el
override de mi backend de agencia (modo Tech Provider). El CRM consume el token — NO
implementa el Embedded Signup.

**Why this priority**: Sin conexión del número no existe el producto en producción; y el
modo agencia es la razón de ser del proyecto (agencias desplegando por cliente).

**Independent Test**: Completar el wizard contra el entorno de pruebas interno (token
válido → guarda cifrado; token inválido → error claro sin guardar); verificar que el
webhook responde el handshake de verificación en la URL con token en la ruta y rechaza
segmentos incorrectos con 404.

**Acceptance Scenarios**:

1. **Given** el wizard de conexión, **When** el usuario pega WABA ID, Phone Number ID y
   token y pulsa "probar conexión", **Then** el sistema valida token↔número contra la API
   de Meta ANTES de guardar; si es válido, guarda el token cifrado y muestra el estado
   conectado; si no (p. ej. token expirado), muestra un error claro y NO guarda.
2. **Given** la conexión guardada, **When** el usuario ve el panel, **Then** ve la URL
   COMPLETA del webhook lista para copiar (incluye el token de verificación como segmento
   de la ruta, construida sobre el dominio público https de la instancia).
3. **Given** el webhook público, **When** Meta (o el backend de la agencia) hace el
   handshake de verificación GET con el token correcto, **Then** responde el challenge;
   **When** cualquier POST llega con el segmento de token incorrecto, **Then** responde
   404 sin ningún efecto en el sistema.
4. **Given** el secreto de firma de la app configurado (opcional, recomendado en modo
   directo), **When** llega un POST con firma inválida, **Then** responde 401 y no
   procesa; **Given** que NO está configurado, **Then** el webhook funciona protegido por
   la URL secreta y Configuración muestra un aviso informativo (no un error).
5. **Given** el wizard, **When** el usuario lo lee, **Then** distingue los DOS orígenes
   del token: (a) modo directo — app de Meta propia del negocio (token de usuario del
   sistema; ahí conviene configurar también el secreto de firma); (b) modo agencia (Tech
   Provider) — el token lo obtiene el backend de la agencia al completar SU Embedded
   Signup, sin secreto de firma.
6. **Given** el README, **When** la agencia sigue el checklist de modo agencia, **Then**
   encuentra los 5 pasos exactos con diagrama de texto: (1) desplegar la instancia
   primero, (2) Embedded Signup + token exchange en el backend de la agencia,
   (3) configurar el override del callback hacia la URL del wizard con el verify token de
   esta instancia (a nivel WABA), (4) registrar el número si aplica, (5) pegar
   credenciales en el wizard y probar conexión. La sintaxis del override se verifica
   contra la documentación oficial de Meta antes de publicarse.

---

### User Story 6 - Plantillas de WhatsApp acotadas (Priority: P2)

Como operador, creo plantillas de mensaje (nombre, idioma, categoría, cuerpo con UNA
variable), las mando a aprobación de Meta, veo su estado sincronizado (pendiente /
aprobada / rechazada con razón), y puedo enviar una plantilla aprobada desde la bandeja
cuando la ventana de 24 horas está cerrada.

**Why this priority**: Completa el ciclo de la ventana de 24h de US1 (sin plantillas, las
conversaciones frías son un callejón sin salida), pero el CRM funciona sin ella para
conversaciones activas.

**Independent Test**: Crear una plantilla contra el entorno de pruebas → estado pendiente
→ simular el evento de aprobación → estado aprobada → abrir una conversación con ventana
cerrada → enviar la plantilla → verificar el envío en la bandeja de salida simulada.

**Acceptance Scenarios**:

1. **Given** la pestaña Plantillas, **When** el usuario crea una plantilla (nombre,
   idioma, categoría, cuerpo con una variable `{{1}}`), **Then** se envía a aprobación de
   Meta y queda en estado pendiente.
2. **Given** una plantilla pendiente, **When** llega el evento de cambio de estado de
   Meta (aprobada o rechazada), **Then** el estado se actualiza en la UI; si fue
   rechazada, se muestra la razón.
3. **Given** una conversación con ventana de 24h cerrada, **When** el operador abre el
   selector de plantillas ofrecido por la bandeja, **Then** puede elegir una plantilla
   APROBADA, completar el valor de la variable, y enviarla; el mensaje sale correctamente
   y aparece en el hilo.
4. **Given** el alcance v1, **Then** variables múltiples y borrado de plantillas quedan
   en el roadmap (documentado).

---

### User Story 7 - Multi-usuario mínimo (Priority: P3)

Como dueño del negocio, me registro como el primer usuario (creando la organización) y
creo cuentas para mi equipo desde Configuración (email + contraseña temporal), sin
sistema de invitaciones ni emails. Después de la primera organización, el registro
público queda cerrado.

**Why this priority**: El negocio puede operar con una sola cuenta; el equipo mínimo es
mejora incremental.

**Independent Test**: Registrar el primer usuario → org creada; intentar un segundo
registro público → deshabilitado; crear cuenta de equipo desde Configuración → login
funciona.

**Acceptance Scenarios**:

1. **Given** una instancia recién instalada sin organizaciones, **When** el primer
   usuario se registra, **Then** se crean su cuenta y la organización, y él queda como
   propietario.
2. **Given** una organización existente, **When** alguien más intenta registrarse desde
   la página pública, **Then** el registro está deshabilitado con mensaje claro (salvo
   que el operador habilite explícitamente la variable de escape).
3. **Given** el propietario en Configuración → Equipo, **When** crea una cuenta con email
   y contraseña temporal, **Then** el nuevo usuario puede iniciar sesión con esa
   contraseña.
4. **Given** los formularios de login/registro, **When** reciben intentos repetidos
   abusivos desde una IP, **Then** se aplica limitación de tasa.

---

### User Story 8 - Instalación en 15 minutos (Priority: P1)

Como agencia, instalo Vocero en el VPS de mi cliente en ~15 minutos siguiendo el README:
por la Ruta A (panel Coolify guiado por un asistente de IA con el archivo INSTALL-IA.md)
o por la Ruta B (docker compose con HTTPS automático). Al terminar, el sistema me indica
explícitamente que la conexión de WhatsApp se hace después, desde Configuración →
WhatsApp.

**Why this priority**: La instalación ES el producto (el video es el instalador oficial);
si no instala a la primera, el proyecto falla en su propósito.

**Independent Test**: En un directorio temporal, clonar el repo y seguir el README de la
Ruta B literalmente (modo de pruebas interno) hasta ver la bandeja funcionando.

**Acceptance Scenarios**:

1. **Given** un VPS con Coolify y el archivo INSTALL-IA.md, **When** el asistente de IA
   lo ejecuta con el MCP de Coolify, **Then** despliega la base de datos y la app,
   configura dominio y variables, y verifica el healthcheck — preguntando al usuario
   SOLO: dominio (obligatorio), token de OpenRouter (opcional) y ruta A o B; los secretos
   los genera él mismo.
2. **Given** un VPS con Docker (sin Coolify), **When** el usuario sigue la Ruta B,
   **Then** `docker compose up` levanta app + base de datos + proxy con HTTPS automático
   usando la variable `DOMAIN`, con healthchecks en los tres servicios.
3. **Given** la instalación terminada, **When** finaliza, **Then** el instalador dice
   explícitamente: "entra a Configuración → WhatsApp para conectar tu número; ahí verás
   la URL exacta del webhook" — la conexión de WhatsApp NO es parte del despliegue.
4. **Given** la base de datos vacía en el primer arranque, **When** el usuario entra,
   **Then** ve un estado vacío con botón "Cargar datos de demostración" que puebla el
   negocio demo ("Ferretería El Martillo": ~8 contactos, conversaciones realistas en MXN,
   leads en el kanban, knowledge base lleno con 1–2 huecos INTENCIONALES —garantías y
   devoluciones— y una corrida de Laboratorio de ejemplo guardada).
5. **Given** el README público, **When** una agencia lo lee, **Then** encuentra: qué es
   (con captura) → para quién → features (Laboratorio primero) → requisitos → apuntar el
   dominio a la VPS → instalación A y B → configuración de Meta paso a paso → modo
   agencia (checklist de 5 pasos + diagrama + nota de seguridad del token en la URL) →
   configuración de la IA → cumplimiento con políticas de Meta (5 puntos, incluyendo que
   el Laboratorio es 100% interno) → FAQ de errores comunes → roadmap → licencia MIT →
   créditos.

---

### Edge Cases

- **Webhook**: evento duplicado (mismo ID de mensaje) → un solo mensaje persistido;
  segmento de token incorrecto → 404 sin efectos; firma inválida (cuando el secreto está
  configurado) → 401; payloads de eventos no soportados (reacciones, stickers) → se
  ignoran sin error.
- **Ventana de 24h**: exactamente en el límite; conversación sin ningún mensaje entrante
  (iniciada por plantilla); el agente NUNCA envía texto libre con ventana cerrada.
- **Agente**: proveedor caído o respuesta no parseable → reintento con extracción
  robusta; persistencia del fallo → escalado a humano; mensajes en ráfaga → una sola
  respuesta agrupada; dos webhooks simultáneos de la misma conversación → el bloqueo
  evita doble turno.
- **Laboratorio**: corrida interrumpida por reinicio → marcada fallida al arrancar;
  segunda corrida simultánea → rechazada; juez devuelve formato inválido → reintento y,
  si persiste, el caso queda marcado sin veredicto (no cuelga la corrida).
- **Wizard**: token válido pero de otro número → error claro; instancia sin dominio
  público aún → la URL del webhook se muestra con el valor configurado y una advertencia.
- **Kanban**: arrastrar a la misma etapa; contacto archivado con lead activo; eliminación
  de una etapa con leads (reasignación requerida).
- **Registro**: dos registros simultáneos en instancia vacía → solo uno crea la
  organización.
- **Instalación**: variables faltantes al arrancar → mensaje de error claro (validación
  de entorno), no un crash críptico.

## Requirements *(mandatory)*

### Functional Requirements

**Bandeja (US1)**

- **FR-001**: El sistema MUST mostrar una bandeja de 3 columnas: lista de conversaciones,
  hilo de mensajes y panel del contacto.
- **FR-002**: Los mensajes entrantes MUST aparecer en la bandeja abierta sin recargar,
  en ≤2 segundos desde su recepción, mediante un canal de eventos del servidor que
  funcione detrás de proxies HTTP estándar y sin requerir un servidor personalizado.
- **FR-003**: El canal de tiempo real MUST reconectarse solo tras una interrupción y
  recuperar los mensajes del hueco sin intervención del usuario.
- **FR-004**: El operador MUST poder enviar respuestas de texto desde el panel, con
  estados visibles del mensaje (enviado / entregado / leído) actualizados por eventos.
- **FR-005**: El sistema MUST hacer visible el estado de la ventana de 24 horas; con
  ventana cerrada MUST bloquear el campo de texto, explicar el motivo y ofrecer el envío
  de plantilla aprobada.
- **FR-006**: Los mensajes entrantes multimedia MUST mostrarse como indicador de tipo
  (v1); los avatares MUST ser iniciales con color estable por contacto.

**Contactos y pipeline (US2)**

- **FR-010**: Todo remitente nuevo MUST quedar registrado automáticamente como contacto
  (nombre del perfil, editable) con un lead en la primera etapa.
- **FR-011**: El kanban MUST soportar arrastrar y soltar con persistencia, etapas
  configurables (sembradas: Nuevo → En conversación → Interesado → Cliente → Perdido) y
  anclas de ganado/perdido.
- **FR-012**: Cada tarjeta MUST mostrar contacto, última actividad y enlace directo a su
  conversación.
- **FR-013**: La vista de lista MUST ofrecer búsqueda, notas por contacto y archivado
  reversible.

**Agente (US3)**

- **FR-020**: La pestaña Agente MUST tener dos secciones: Comportamiento (nombre, tono,
  instrucciones, reglas de escalado, saludo) y Knowledge base (entradas
  pregunta/respuesta + bloques de texto libre, con CRUD y contador de tamaño con aviso
  al acercarse al límite de contexto).
- **FR-021**: El agente MUST responder usando comportamiento + KB completos (v1 inyecta
  todo el KB; el límite se documenta), y MUST ejecutar como máximo una acción tipada por
  turno: `none | reply | update_lead | move_stage | handoff`, con salida estructurada
  validada.
- **FR-022**: El handoff MUST dispararse en 3 casos: el cliente lo pide (detección del
  modelo + patrón de respaldo por intención que NO se dispara con "somos 4 personas"),
  el modelo lo decide, o error/ventana cerrada. Tras handoff: badge visible + IA
  silenciada en esa conversación hasta reactivación explícita.
- **FR-023**: El agente MUST tener toggle global y por conversación.
- **FR-024**: Los mensajes en ráfaga MUST agruparse en un solo turno (debounce) y cada
  conversación MUST tener bloqueo que impida turnos concurrentes.
- **FR-025**: El proveedor de IA MUST accederse solo a través del adaptador
  OpenRouter-compatible (URL base, modelo y modelo del juez configurables por entorno;
  el modelo del juez por defecto es el modelo principal); la salida del modelo MUST
  tolerarse con extracción robusta y reintentos — un solo hipo del proveedor nunca tumba
  el turno.
- **FR-026**: Sin token de IA configurado, las pestañas Agente y Laboratorio MUST mostrar
  estado vacío explicativo con acciones deshabilitadas; el proveedor de prueba interno
  NUNCA es fallback fuera de desarrollo.

**Laboratorio (US4)**

- **FR-030**: El Laboratorio MUST ejecutar 6 personas guionadas fijas (secuencias
  predefinidas de 4–5 mensajes, sin LLM para el cliente simulado) contra el agente real
  (mismo pipeline de US3) en conversaciones marcadas de prueba, con agrupación de
  mensajes desactivada (debounce en 0) y turnos secuenciales.
- **FR-031**: Las conversaciones de prueba MUST tener prohibido alcanzar la API de
  WhatsApp: el componente de envío MUST lanzar una excepción si lo intenta (aserción
  dura con test unitario).
- **FR-032**: Un juez independiente MUST evaluar cada conversación con UNA llamada (6 por
  corrida), recibiendo transcript completo + KB + comportamiento, y devolver un veredicto
  estructurado y validado: verde/amarillo/rojo + hallazgos tipados (alucinación /
  fuera_de_kb / debió_escalar / tono) con evidencia y sugerencia opcional
  (pregunta/respuesta).
- **FR-033**: El reporte MUST mostrar score global 0–100 (% ponderado de conversaciones
  verdes), tarjetas de hallazgo con evidencia, y sugerencias aplicables con un click que
  pre-llenan una entrada del KB para editar y guardar; el historial MUST listar corridas
  con delta de score vs la anterior (sin gráficas en v1).
- **FR-034**: La ejecución MUST ser en segundo plano dentro del proceso (sin cola
  externa), con progreso consultable, timeout global de 10 minutos → fallida, máximo 1
  corrida concurrente por organización (bloqueo en base de datos), y corridas "corriendo"
  huérfanas al arrancar → fallidas.
- **FR-035**: La UI del Laboratorio MUST declarar de forma permanente que es un sandbox
  interno que no envía mensajes reales.

**Conexión del número (US5)**

- **FR-040**: El wizard MUST capturar WABA ID, Phone Number ID y token; MUST validar
  token↔número contra la API de Meta antes de guardar; y MUST guardar el token cifrado
  en reposo.
- **FR-041**: El webhook MUST vivir en una ruta que incluye el token de verificación como
  segmento secreto; el handshake GET MUST validar el token; todo POST con segmento
  incorrecto MUST responder 404 sin efectos.
- **FR-042**: La verificación de firma MUST aplicarse solo si el secreto de la app está
  configurado (firma inválida → 401); sin secreto, Configuración MUST mostrar aviso
  informativo (no error) de que la protección es por URL secreta.
- **FR-043**: El panel MUST mostrar la URL COMPLETA del webhook lista para copiar,
  construida sobre el dominio público https configurado.
- **FR-044**: El wizard MUST explicar los dos orígenes del token (modo directo con app
  propia / modo agencia Tech Provider vía Embedded Signup de la agencia con override del
  callback); el CRM MUST NOT implementar Embedded Signup.
- **FR-045**: El README MUST incluir el checklist de modo agencia de 5 pasos con diagrama
  de texto y nota de seguridad sobre el token en la URL, con la sintaxis del override
  verificada contra la documentación oficial de Meta.

**Plantillas (US6)**

- **FR-050**: El sistema MUST permitir crear plantillas (nombre, idioma, categoría,
  cuerpo con exactamente una variable), enviarlas a aprobación y reflejar su estado
  (pendiente/aprobada/rechazada con razón) sincronizado por el evento de cambio de
  estado.
- **FR-051**: Desde una conversación con ventana cerrada, el operador MUST poder elegir
  una plantilla aprobada, completar la variable y enviarla; el mensaje MUST registrarse
  en el hilo.

**Multi-usuario (US7)**

- **FR-060**: El primer registro MUST crear usuario + organización (propietario); con
  una organización existente el registro público MUST estar cerrado salvo variable de
  escape explícita.
- **FR-061**: El propietario MUST poder crear cuentas de equipo (email + contraseña
  temporal) desde Configuración, sin emails ni invitaciones.
- **FR-062**: Login y registro MUST tener limitación de tasa por IP.

**Instalación (US8)**

- **FR-070**: El repositorio MUST desplegar limpio en Coolify como app Docker (imagen
  multi-etapa, migraciones al arrancar, healthcheck en `/api/health`, base de datos como
  servicio separado), guiado por `INSTALL-IA.md` para un asistente de IA con el MCP de
  Coolify.
- **FR-071**: `INSTALL-IA.md` MUST preguntar solo dominio (obligatorio), token de
  OpenRouter (opcional) y ruta A o B; MUST generar los secretos él mismo (incluido el
  token de verificación del webhook que define la ruta); y MUST terminar indicando que la
  conexión de WhatsApp se hace en Configuración → WhatsApp.
- **FR-072**: La Ruta B MUST ser un `docker-compose.yml` con app + base de datos + proxy
  con HTTPS automático (variable `DOMAIN`), URL de base de datos interna y healthchecks
  en los tres servicios.
- **FR-073**: El README MUST seguir la estructura completa definida en US8 escenario 5,
  en español neutro.
- **FR-074**: `.env.example` MUST contener todas las variables con placeholders
  `REEMPLAZA_...`, guía inline y comando de generación de cada secreto; la variable del
  modo de pruebas interno MUST NOT aparecer en él.
- **FR-075**: Con base de datos vacía, la UI MUST ofrecer "Cargar datos de demostración"
  (también vía script y variable), sembrando el negocio demo con los huecos intencionales
  del KB y una corrida de Laboratorio de ejemplo, de forma idempotente.

**Seguridad de instancia pública (transversal, cada regla con test unitario)**

- **FR-080**: Las rutas del entorno de pruebas interno (mock de WhatsApp y de IA) MUST
  responder 404 incondicional en producción.
- **FR-081**: El registro MUST cerrarse tras la primera organización (salvo escape) y
  login/registro MUST tener limitación de tasa (= FR-060/FR-062).
- **FR-082**: El Laboratorio MUST tener bloqueado el acceso a la API real de WhatsApp
  (= FR-031).
- **FR-083**: El webhook MUST rechazar segmento de token incorrecto con 404 y, con
  secreto configurado, firma inválida con 401 (= FR-041/FR-042).
- **FR-084**: Todo evento entrante MUST procesarse de forma idempotente (ID de mensaje
  único; duplicado → sin efectos adicionales).
- **FR-085**: Todo dato de dominio MUST estar aislado por organización; ninguna consulta
  sin ámbito de tenant.

### Key Entities

- **Organización / usuarios** (del sistema de auth): `user`, `session`, `account`,
  `verification`, `organization`, `member`, `invitation` (esta última sin UI en v1).
- **contact**: persona que escribe por WhatsApp; nombre del perfil editable, teléfono,
  notas, archivado; pertenece a una organización.
- **pipeline_stage**: etapa configurable del kanban con orden y anclas ganado/perdido.
- **lead**: oportunidad de un contacto; referencia a su etapa; última actividad.
- **conversation**: hilo con un contacto; incluye marca `is_test` (Laboratorio), estado
  de handoff y toggle de IA.
- **message**: mensaje entrante/saliente; ID de WhatsApp único (idempotencia), estados,
  marca de generado por IA, tipo de contenido.
- **meta_credentials**: conexión del número (WABA ID, Phone Number ID único, token
  cifrado, estado).
- **agent_profile**: comportamiento del agente (nombre, tono, instrucciones, reglas de
  escalado, saludo, toggle global).
- **kb_entry**: entrada del knowledge base (pregunta/respuesta o bloque libre).
- **template**: plantilla de WhatsApp (nombre, idioma, categoría, cuerpo, estado, razón
  de rechazo, ID externo).
- **agent_test_run**: corrida del Laboratorio (score, estado, inicio/fin).
- **agent_test_case**: caso por persona (transcript, veredicto, hallazgos, sugerencias).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un mensaje entrante aparece en la bandeja abierta en ≤2 segundos sin
  recargar, tanto en desarrollo como detrás del proxy de la instalación Ruta B.
- **SC-002**: Una agencia puede completar la instalación (Ruta A o B) en ~15 minutos
  hasta ver la pantalla de login, sin tocar código.
- **SC-003**: El flujo completo del Laboratorio (correr → reporte con ≥1 hallazgo
  accionable → aplicar sugerencia → re-correr → delta visible) se completa sin
  intervención técnica y sin que ningún mensaje simulado salga a WhatsApp.
- **SC-004**: El 100% de los eventos entrantes duplicados no genera efectos duplicados;
  el 100% de los POST al webhook con token de ruta incorrecto responde 404 sin efectos.
- **SC-005**: Con la ventana de 24h cerrada, el 100% de los intentos de envío de texto
  libre (humano o agente) queda bloqueado, y el envío de plantilla aprobada funciona.
- **SC-006**: Un cliente simulado que pide un humano produce handoff en el 100% de los
  casos de la evaluación; la frase "somos 4 personas" no lo produce nunca (test).
- **SC-007**: Todo el texto de producto visible está en español neutro; el repositorio
  público no contiene secretos ni referencias privadas (auditoría de fugas en verde).
- **SC-008**: Instancia sin token de IA: bandeja, kanban, plantillas y conexión funcionan
  al 100%; Agente y Laboratorio muestran su estado vacío explicativo.

## Assumptions

- El equipo del negocio opera en español; v1 no incluye i18n.
- v1: multimedia entrante solo como indicador de tipo; RAG del KB, personas
  configurables del Laboratorio, variables múltiples de plantillas, analytics, broadcast
  e Instagram quedan en el roadmap del README.
- La aprobación real de plantillas por Meta tarda horas/días; el producto refleja el
  estado pendiente honestamente.
- El modo agencia asume el caso típico de una WABA por cliente (override a nivel WABA).
- La instancia corre en un VPS con dominio propio y HTTPS (requisito de Meta para
  webhooks).
- El entorno de pruebas interno (mock de WhatsApp + mock de IA) existe solo para
  desarrollo y verificación; jamás disponible en producción.

## Out of Scope (v1)

Marketing masivo / broadcast, constructor visual de flujos, scraping, Instagram,
email/notificaciones externas, billing/planes, S3/almacenamiento externo, Embedded
Signup propio (se consume el de la agencia), analytics de plantillas, multimedia
completa, RAG, invitaciones por email, i18n.
