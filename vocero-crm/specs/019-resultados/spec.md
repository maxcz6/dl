# Feature Specification: Resultados — ventas, el agente, de dónde llegan y qué se está cayendo

**Feature Branch**: `feat/resultados`, sobre la rama de #67
(`feat/anuncio-de-origen`), que agrega `ad_attribution.image_asset_id` y los
helpers de anuncio que esta pantalla reutiliza. Se fusiona después de #67.

**Created**: 2026-09-21

**Status**: Especificada antes de escribir código.

**Input**: decisión del dueño el 2026-09-21: traer al raíz la pantalla
Resultados de Vocero Cloud (101 W6, con la tabla por anuncio de 212) **sin
gasto publicitario y sin ninguna dependencia externa**.

**Carril**: ligero (Principio VI). No migra: solo LEE tablas que ya existen
(`lead`, `lead_stage_event`, `conversation`, `message`, `ad_attribution`,
`booking`). Tampoco toca un contrato publicado: `/api/analytics/*` son rutas
internas con sesión que solo consume la UI de este repo.

## Contexto

El CRM sabe dónde está cada lead hoy y, desde la bitácora de etapas, cómo llegó
ahí. Pero ninguna pantalla contesta lo que el dueño pregunta cada semana:
¿cuántos prospectos entraron? ¿cuánto cerré y dónde se atoran? ¿el agente
contesta, qué tan rápido, cuántas veces pasa a un humano? ¿qué anuncio me trae
gente que compra? ¿qué se está enfriando ahora mismo?

## Decisiones del dueño (2026-09-21)

- **D1 — Sin gasto publicitario.** No entran la tabla de gasto, la carga
  manual, el costo por prospecto/cliente ni el retorno. Con carga manual el
  número depende de que alguien capture; con conector, de la API de Marketing
  de Meta. Contar no depende de nadie.
- **D2 — Origen y anuncios solo con CONTEOS**: conversaciones, prospectos y
  ventas por origen y por anuncio. Salen del `referral` que el webhook ya guarda
  (018): ni API de Marketing ni conector.
- **D3 — Siempre disponible, sin bandera**: la pantalla no depende de nada
  externo, así que no es un módulo opcional.
- **D4 — Con `AGENDA` apagada no hay citas**: ni tarjetas ni números de citas,
  y la API no las calcula.
- **D5 — Sin migración**: lo que en Cloud pide columnas que el raíz no tiene
  (la probabilidad de cierre y su «dinero esperado») se queda fuera.
- **D6 — El Laboratorio no existe para Resultados**: ni sus conversaciones, ni
  sus contactos, ni sus citas de prueba mueven un número.

## Alcance

**Dentro**: la entrada «Resultados» en el menú (después de Contactos); un rango
con atajos; cuatro secciones que cargan cada una por su cuenta; el periodo
anterior de la misma duración como comparación.

**Fuera**: ver «Qué se decidió NO hacer» al final.

## User Scenarios & Testing

### User Story 1 — Ventas y embudo (Priority: P1)

El dueño abre Resultados y ve, para el periodo elegido, lo que entró, lo que
se cerró y dónde se atoran los tratos.

**Acceptance Scenarios**:

1. **Given** leads creados y movidos de etapa, **When** abre Resultados sin
   elegir nada, **Then** ve los últimos 30 días terminando hoy, con días
   cortados en la zona del negocio (la de la agenda; sin agenda,
   `America/Mexico_City`).
2. **Given** el periodo, **Then** ve prospectos nuevos, tratos ganados, dinero
   ganado y tratos perdidos, cada uno contra el periodo anterior; tasa de
   cierre (ganados ÷ ganados+perdidos) siempre con su denominador; y ticket
   promedio solo sobre ganados con monto.
3. **Given** un trato ganado, sacado de Ganado y vuelto a ganar dentro del
   periodo, **Then** cuenta UNA vez y su monto una vez. **Given** un trato
   sacado de Ganado de vuelta al embudo, **Then** no cuenta como ganado.
4. **Given** montos en otra moneda, **Then** no se suman con la del negocio:
   se cuentan aparte y la pantalla lo dice.
5. **Given** prospectos creados en el periodo, **Then** el embudo dice cuántos
   alcanzaron cada etapa abierta y Ganado (contados una vez por lead), con la
   proporción que pasa a la siguiente.
6. **Then** ve los días promedio por etapa y del primer contacto al cierre,
   sin usar movimientos aproximados (los que sembró la migración 0004).
7. **Then** ve por qué se perdieron los tratos, con su conteo.
8. **Then** ve «Hoy en el embudo»: el monto de los tratos abiertos y cuántos
   no tienen monto. Es el presente, no el periodo, y lo dice.
9. **Given** un periodo sin prospectos ni cierres, **Then** la sección dice que
   no hay datos en vez de pintar ceros.

### User Story 2 — El agente (Priority: P1)

**Acceptance Scenarios**:

1. **Given** conversaciones que empezaron en el periodo, **Then** ve cuántas
   fueron, en cuántas de las que escribió el cliente contestó el agente
   (mensaje con origen IA, del agente o de un cerebro externo), la mediana del
   tiempo a esa primera respuesta, y cuántas pasaron a un humano con el motivo.
2. **Given** que ningún contacto real tiene ficha, **Then** la ficha dice que
   este agente no la llena (no «0 %»).
3. **Given** `AGENDA` encendida y citas en el periodo, **Then** ve agendadas,
   realizadas, no llegaron, canceladas y la tasa de asistencia. **Given**
   `AGENDA` apagada, **Then** no hay nada de citas y la API devuelve
   `sessions: null`.

### User Story 3 — Origen y anuncios (Priority: P1)

**Acceptance Scenarios**:

1. **Given** conversaciones y prospectos del periodo, **Then** una tabla por
   origen (anuncio, orgánico, referido, conocido, otro, sin identificar) dice
   conversaciones, prospectos y ventas. El origen es el capturado; sin
   capturar, «anuncio» si la conversación la abrió un anuncio (no una
   publicación), igual que la ficha del contacto (018).
2. **Given** conversaciones abiertas por anuncios, **Then** una tabla por
   anuncio enseña la miniatura del creativo (o el megáfono sin imagen), el
   titular, el `source_id`, conversaciones, prospectos, ventas y la tasa de
   cierre con su denominador. Una publicación dice «Publicación», no
   «Anuncio».
3. «Ventas» de un origen o anuncio = de los prospectos que llegaron en el
   periodo, cuántos están hoy en Ganado. Así la tasa de cierre de la fila no
   pasa de 100 %.
4. Un contacto cuenta con el PRIMER anuncio que lo trajo.

### User Story 4 — Qué se está cayendo (Priority: P2)

No es histórico: describe el ahora y no toma rango.

**Acceptance Scenarios**:

1. **Then** ve los leads abiertos cuyo cliente lleva más de 7 días sin
   escribir, cuántos son y el dinero que se enfría.
2. **Then** ve los mensajes que no llegaron en los últimos 30 días, agrupados
   por motivo.
3. **Then** ve las conversaciones con la ventana de 24 h por cerrarse (entre 20
   y 24 h desde el último mensaje del cliente, sin respuesta posterior).
4. Cada persona de la lista lleva a su conversación (`/inbox?contact=`).
5. **Given** nada pendiente, **Then** lo dice con una sola línea.

### Edge Cases

- Rango invertido, fecha con formato inventado o más de 366 días → 422 con
  mensaje, jamás un 500.
- Una zona horaria inválida guardada en la agenda no tumba la pantalla: se usa
  la de por defecto.
- Sin sesión, cualquier ruta de analítica → 401.
- Una sección que falla enseña su error; las otras tres siguen.
- Cambiar el rango conserva los números anteriores atenuados mientras llegan
  los nuevos: sin parpadeo ni salto.

## Requirements

- **FR-001**: Todas las consultas pasan por `scoped()` con la organización de
  la sesión (`withAuth`).
- **FR-002**: Toda tasa se calcula en el servidor con el mismo helper, viaja
  con su denominador y se marca con muestra chica (< 10). La UI no divide.
- **FR-003**: Todo lo que depende de un contacto excluye al contacto cuya ÚNICA
  conversación es de prueba; lo que depende de una conversación excluye
  `is_test`; las citas excluyen `is_test`.
- **FR-004**: Los cortes de día y mes son de la zona del negocio; el fin del
  periodo es exclusivo; el periodo anterior dura lo mismo y termina donde
  empieza el actual.
- **FR-005**: El dinero es entero en centavos y solo suma el de la moneda del
  negocio.
- **FR-006**: La serie temporal no usa doble eje: prospectos y dinero ganado
  son dos gráficas de barras con su propia escala, con valor al pasar el
  puntero y una tabla equivalente para lector de pantalla.

## Qué se decidió NO hacer, y por qué

- **Gasto, costo por prospecto, costo por cliente, retorno (ROAS)**: D1.
- **Dinero esperado (monto × probabilidad de cierre)**: el raíz no tiene
  `lead.close_probability` ni las señales de Cloud que la calculan (D5).
- **Dinero por origen y por anuncio**: D2 los pide en conteos. El dinero
  ganado del periodo sí está, en Ventas.
- **Campaña, conjunto, impresiones, clics**: no vienen en el `referral`;
  exigen la API de Marketing.
- **Origen de Instagram y Messenger**: su `referral` tiene otra forma y no se
  guarda (018, D3); sus conversaciones cuentan por la fuente capturada o como
  «sin identificar».
- **Zona horaria propia de Resultados**: se usa la de la agenda. Una instancia
  sin agenda corta los días en `America/Mexico_City`.
- **Cotizaciones y acciones vencidas**: tablas que Vocero no tiene (Cloud
  tampoco las trajo).

## Constitution Check

- **I Seguridad**: no hay secretos en juego; las rutas exigen sesión.
- **II Soberanía**: cero terceros. Solo lectura de la base propia; la
  miniatura es el adjunto que 018 ya copió al volumen local.
- **III Multi-tenancy**: `scoped()` en cada consulta (FR-001).
- **IV Idempotencia**: solo lectura; no escribe nada.
- **Sandbox del Laboratorio**: excluido de todo número (D6, FR-003).
- **Módulos opcionales**: la pantalla no depende de nada, así que no lleva
  bandera (D3); las citas respetan la bandera `AGENDA` (D4).
- **VIII Foco vertical**: medir cuánto de lo que llega por WhatsApp se
  convierte es el CRM, no marketing.
- **IX Verificación en vivo**: `pnpm test:e2e:resultados` siembra por el
  webhook y la API reales (con y sin anuncio, etapas, una venta, respuestas del
  agente, un escalamiento, un envío fallido, una corrida del Laboratorio) y
  compara lo que devuelve cada bloque.

## Success Criteria

- **SC-001**: Los números de las cuatro secciones cuadran con lo sembrado por
  el guion E2E, con la bandera `AGENDA` apagada y encendida.
- **SC-002**: Una corrida del Laboratorio no cambia ningún número.
- **SC-003**: `/results` no se recorta a lo ancho en teléfono (390 px), ni en
  claro ni en oscuro.
