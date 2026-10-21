# Feature Specification: Atribución de anuncios y Conversions API (bandera `ATRIBUCION`)

**Feature Branch**: `016-atribucion-capi`

**Created**: 2026-08-28

**Status**: Implementada y verificada en vivo (2026-08-28) — arnés E2E en verde en las dos configuraciones de la bandera

**Input**: Decisión del dueño 2026-08-28: llevar a Vocero raíz, **en modo
bandera** (como la multicanalidad de IG y el motor de agenda), lo que el fork de
agencia lleva en producción desde el 29-jul-2026 sobre la **Conversions API de
Meta**. Alcance acordado en la misma decisión: **núcleo neutro** — capturar el
origen del anuncio, reportar el lead calificado y la venta, y una pantalla para
configurarlo y ver qué se reportó. Nada de la operación avanzada de la agencia
(ver "Fuera de alcance").

## Contexto de negocio

Un negocio que anuncia con **Click-to-WhatsApp** (CTWA) paga por conversaciones.
Meta sabe cuáles empezaron; **no sabe cuáles sirvieron**. Sin nadie que se lo
diga, el algoritmo optimiza hacia lo único que ve —que alguien abra el chat— y
entrega el público más barato de hacer escribir, que no es el que compra. El
negocio lo vive como "me llegan muchos mensajes y no cierro ninguno".

Vocero está en el único lugar donde esa verdad existe: sabe que la conversación
`cv_x` vino del anuncio `A`, que su lead se calificó el martes y que se ganó el
viernes por $12,000. La Conversions API es el camino oficial para devolverle a
Meta ese desenlace, y `business_messaging` es su variante para conversaciones de
WhatsApp: se manda el `ctwa_clid` del clic —no el teléfono— y Meta lo empata con
la campaña que lo generó.

Con eso, el mismo presupuesto empieza a comprar *leads calificados* en vez de
*chats*. Es la diferencia entre un CRM que ordena conversaciones y uno que
participa en el resultado.

### Por qué ahora, y por qué no antes

Esta feature tiene historia y conviene decirla completa:

1. El fork de agencia la implementó en julio (su spec 004) y la opera desde
   entonces. En la evaluación de upstream del 2026-08-15 se decidió **no
   subirla**, con un motivo correcto: aquel código manda `partner_agent:
   "aishia-crm"` y **codifica decisiones de producto de una agencia** —vetar el
   evento de "sesión agendada" porque su tasa de asistencia era 0%, duplicar
   cada lead calificado con un `InitiateCheckout` para poder optimizar una
   campaña de ventas—. Eso es la operación de un negocio, no el núcleo de un CRM.
2. Lo que cambió no es la opinión sobre ese código, sino que ahora existe el
   **carril**: ADR-001 (canales) y ADR-002 / feature 015 (agenda) establecieron
   que lo opcional viaja en `main`, apagado tras una bandera, con la migración
   aplicada igual. La constitución 1.4.0 lo escribió como categoría.
3. Así que sube **el mecanismo, sin las decisiones**: qué etapa significa
   "calificado" lo elige cada negocio en su pantalla; el evento de venta cuelga
   de la etapa ganada que el CRM ya tiene; y `partner_agent` dice `vocero-crm`.

## Alcance

**Entra** (núcleo neutro):

- Capturar el origen del anuncio (`referral`, con su `ctwa_clid`) cuando el
  primer mensaje de una conversación viene de un anuncio CTWA.
- Reportar a Meta **`QualifiedLead`** cuando el lead entra a la etapa que el
  negocio marcó como "lead calificado".
- Reportar **`Purchase`** cuando el lead entra a una etapa **ganada**, con el
  monto del trato si está capturado.
- Pantalla de Ajustes para conectar el dataset y elegir esa etapa, más la
  **actividad reciente**: qué se reportó, cuándo, con qué acuse y —cuando no
  salió— por qué.
- Todo detrás de la bandera `ATRIBUCION`, apagada por defecto.

**Fuera de alcance a propósito** (existe en el fork; no sube en esta feature):

| Qué | Por qué no |
|---|---|
| **Backfill** de conversiones viejas | Operación avanzada; su diseño correcto (anti-join, herencia del `event_time` original, corte terminal fuera de ventana) es media feature por sí solo y solo tiene sentido cuando ya llevas meses reportando. |
| **Laboratorio de eventos** (disparar uno a voluntad) | Herramienta de quien opera campañas a diario; sin ella el CRM se diagnostica igual con la tabla de actividad. |
| **Espejo de venta** (duplicar el calificado como `InitiateCheckout`) | Decisión de producto de una agencia para poder optimizar una campaña de *ventas* con un evento de *clientes potenciales*. Se documenta en la guía como receta; no se cablea. |
| **Miniatura del creativo** y ficha de "de qué anuncio vino" | UI nueva y una descarga de binario dentro de la ingesta. El dato crudo del anuncio **sí** se guarda (`raw`), así que un fork puede pintarlo sin migrar nada. |
| Evento por **cita agendada** | No existe en el catálogo de Meta para mensajería, y reportar "agendó" como conversión enseña la señal equivocada cuando la gente no llega. |

## User Scenarios & Testing

### US1 — La bandera (P1)

**Como** dueño de una instancia que no anuncia,
**quiero** que el CRM no mencione nunca la atribución de anuncios,
**para** no cargar con una pantalla, una credencial y un concepto que no uso.

**Criterios de aceptación**

1. **Dado** una instancia sin `ATRIBUCION`, **cuando** entro a Ajustes,
   **entonces** no existe la pestaña de anuncios.
2. **Dado** esa instancia, **cuando** pido cualquier ruta de la superficie
   (`/api/settings/capi`, `/api/settings/capi/events`, la pantalla), **entonces**
   responde **404** — no 403: en esta instancia eso no existe.
3. **Dado** esa instancia, **cuando** llega un mensaje que sí trae `referral` de
   anuncio, **entonces** se procesa como cualquier mensaje y **no** se guarda
   atribución alguna.
4. **Dado** `ATRIBUCION=on`, **cuando** entro a Ajustes, **entonces** la pestaña
   existe y la instancia opera igual en todo lo demás.

### US2 — Conectar el dataset (P1)

**Como** dueño que anuncia,
**quiero** conectar mi dataset de Meta sin volver a copiar un token,
**para** empezar a reportar en menos de un minuto.

1. **Dado** que ya conecté WhatsApp, **cuando** guardo solo el ID del dataset,
   **entonces** el CRM **reusa el token del negocio** que ya tiene cifrado, y no
   me pide otro.
2. **Dado** que quiero un token distinto, **cuando** lo pego, **entonces** se
   guarda cifrado y hacia afuera solo se ven sus últimos 4.
3. **Dado** que no hay conexión de WhatsApp y no pego token, **cuando** guardo,
   **entonces** falla con `409 sin_whatsapp` y me dice qué hacer.
4. **Cuando** elijo cuál de MIS etapas significa "lead calificado", **entonces**
   queda guardada; si no elijo ninguna, ese evento no se emite (la venta sí).
5. **Cuando** desconecto, **entonces** el dataset y el token se borran y deja de
   reportarse.

### US3 — Capturar el origen del anuncio (P1)

1. **Dado** `ATRIBUCION=on`, **cuando** entra el primer mensaje de una
   conversación con `referral`, **entonces** se guarda su `ctwa_clid` y los datos
   del anuncio, junto a contacto y conversación.
2. **Dado** que Meta reintenta el mismo webhook, **cuando** vuelve a llegar,
   **entonces** no se duplica: el **primer** referral de la conversación gana.
3. **Dado** que el contacto escribe después sin `referral`, **entonces** el
   origen sigue siendo el que se capturó.

### US4 — Reportar el lead calificado (P1)

1. **Dado** un lead cuya conversación vino de un anuncio y un dataset conectado,
   **cuando** el lead entra a la etapa marcada como calificada —lo arrastre el
   dueño, lo mueva el agente incluido o un cerebro externo por `/api/bot/*`—,
   **entonces** el CRM reporta `QualifiedLead` y la actividad lo muestra como
   **enviado** con su `fbtrace_id`.
2. **Dado** que ya se reportó, **cuando** el lead sale y vuelve a esa etapa,
   **entonces** **no** se reporta de nuevo.
3. **Dado** un lead que NO vino de un anuncio, **entonces** queda **omitido**
   con el motivo escrito, y nada falla.
4. **Dado** que Meta está caído o el token venció, **entonces** el lead se mueve
   igual, la fila queda **fallida** con el error, y la operación no se entera.

### US5 — Reportar la venta (P1)

1. **Cuando** el lead entra a una etapa **ganada**, **entonces** se reporta
   `Purchase`; si el trato tiene monto, viaja su **valor y moneda**.
2. **Dado** un trato **sin** monto, **entonces** se reporta la venta **sin**
   valor — nunca `value: 0`: enseñarle a Meta que las ventas de este negocio
   valen cero es peor que no decirle el importe.
3. **Dado** que se saca de Ganado y se vuelve a ganar, **entonces** no se
   re-reporta: a Meta no se le puede des-enviar una compra.
4. **Dado** un lead capturado a mano que nunca escribió por WhatsApp,
   **entonces** no hay nada que atribuir y no se reporta.

### US6 — Ver qué se reportó (P2)

1. **Cuando** abro la pantalla, **entonces** veo las últimas conversiones: quién,
   qué evento, cuándo, su estado y —si falló u omitió— el motivo en palabras.
2. **Dado** un envío exitoso, **entonces** veo el `fbtrace_id`: es la única
   referencia que Meta pide para rastrear un evento de su lado.

### Casos límite

- **Meta responde 200 y descarta el evento.** `events_received` es el único acuse
  real; un 200 con cero recibidos se registra como **fallido** con su
  `fbtrace_id`, no como enviado.
- **Nombre fuera del catálogo.** El catálogo de `business_messaging` es cerrado;
  se valida antes de salir, para fallar con un motivo legible y no con un 400
  opaco de Meta.
- **Conversación de Laboratorio (`is_test`).** Jamás produce un evento hacia
  Meta: mismo guardrail que el sender.
- **Bandera encendida a mitad del camino.** Solo se atribuyen conversaciones
  nuevas: no hay `ctwa_clid` retroactivo. Documentado en la guía.
- **`ctwa_clid` viejo.** Meta puede descartarlo por antigüedad; la fila queda
  fallida con el motivo tal cual lo dio Meta.

## Requisitos funcionales

- **FR-001**: La superficie completa (pantalla, rutas y captura) no existe sin la
  bandera `ATRIBUCION`; la migración se aplica siempre.
  *Enmendado por [018](../018-anuncio-de-origen/spec.md) el 2026-09-21: el
  origen del anuncio se captura y se ve siempre; sin la bandera se guarda sin
  `ctwa_clid`. La pantalla, las rutas y el envío a Meta siguen tras ella.*
- **FR-002**: Con la bandera apagada, el prompt del agente y la operación quedan
  idénticos: la feature no se menciona en ningún lado.
- **FR-003**: El primer `referral` de una conversación se guarda con su
  `ctwa_clid` y su payload crudo; es idempotente por (organización, conversación).
- **FR-004**: El token del dataset se guarda **cifrado** (AES-256-GCM,
  `lib/crypto`) y jamás sale del servidor; hacia el cliente, solo `last4`.
- **FR-005**: Guardar sin token reusa el token del negocio ya conectado.
- **FR-006**: El negocio elige **cuál de sus etapas** significa "lead
  calificado"; sin elección, ese evento no se emite.
- **FR-007**: Entrar a la etapa calificada emite `QualifiedLead`; entrar a una
  etapa ganada emite `Purchase`, con `value`/`currency` si hay monto > 0.
- **FR-008**: Ambos eventos se emiten desde la **puerta única de etapas**
  (`moveLeadToStage`), para que cualquier camino que mueva un lead —dueño, agente
  incluido, bot externo— reporte igual.
- **FR-009**: Dedup por (organización, conversación, evento): la misma
  conversación jamás reporta dos veces el mismo evento.
- **FR-010**: Toda emisión es **best-effort**: ningún fallo de Meta, de red o de
  configuración puede impedir que el lead se mueva.
- **FR-011**: Cada intento deja fila con estado `sent` / `failed` / `skipped` y
  motivo legible; los enviados guardan `fbtrace_id`.
- **FR-012**: Un evento se considera enviado **solo** si `events_received >= 1`.
- **FR-013**: Cada evento viaja con `custom_data.lead_stage` (`qualified` /
  `won`): es lo único contra lo que una conversión personalizada de Meta puede
  escribir reglas.
- **FR-014**: Las conversaciones `is_test` nunca emiten.
- **FR-015**: Cero dependencias de runtime nuevas; misma frontera de salida
  (`lib/meta/client`) que el resto del CRM.
- **FR-016**: El arnés E2E cubre la feature **encendida y apagada**.

## Criterios de éxito

- **SC-001**: Con la bandera apagada, las rutas dan 404, la pestaña no se pinta y
  un inbound con `referral` no deja rastro (verificado en el arnés).
- **SC-002**: Conectar el dataset toma un campo y un clic para quien ya conectó
  WhatsApp.
- **SC-003**: Mover un lead a la etapa calificada deja, en menos de 2 s, una fila
  `sent` con `fbtrace_id` en la actividad.
- **SC-004**: Con Meta devolviendo error, el lead se mueve igual: cero
  movimientos bloqueados en el camino infeliz del arnés.
- **SC-005**: Mover el mismo lead diez veces produce **un** evento por tipo.

## Entidades

- **Atribución de anuncio** — el origen de una conversación: `ctwa_clid`,
  identificadores y textos del anuncio, y el payload crudo. Una por conversación.
- **Evento de conversión** — un intento de reportar un desenlace a Meta: evento,
  estado, acuse, motivo del fallo. Único por (organización, conversación, evento).
- **Configuración de CAPI** — dataset, token cifrado y la etapa que el negocio
  considera "lead calificado". Una por organización.

## Supuestos

- El dataset de `business_messaging` es el de la propia cuenta de WhatsApp del
  negocio (en la práctica, `POST {waba_id}/dataset` devuelve ese mismo id), y el
  token del negocio ya conectado tiene permiso para publicar en él.
- Los nombres `QualifiedLead` y `Purchase` pertenecen al catálogo cerrado de Meta
  para `business_messaging` y se guardan tal cual: sin traducción interna.
