# Research — 016 Atribución de anuncios y Conversions API

Decisiones de la Fase 0. Cada una dice qué se eligió, contra qué, y con qué
evidencia. Buena parte de la evidencia viene de **13 meses-persona de operación
real** del fork de agencia (dataset vivo desde el 29-jul-2026): eso es lo que
esta feature aporta que no se puede sacar de la documentación de Meta.

---

## D1 — La bandera se llama `ATRIBUCION`

**Decisión**: `ATRIBUCION=on`, misma gramática que `AGENDA` (`on`/`1`/`true`/
`si`/`sí`/`yes`), leída de `process.env` directo y declarada en `lib/env.ts`.

**Contra qué**: `CAPI` (el nombre técnico) y `ADS`.

**Por qué**: la bandera enciende dos cosas —capturar de qué anuncio vino una
conversación y reportarle a Meta el desenlace—, y "atribución" es el término que
las abarca. `CAPI` nombra solo la mitad y además es jerga de Meta: el día que
alguien reporte a otra red, la bandera seguiría sirviendo y el nombre no.

**Precedente exacto**: `src/server/agenda/flag.ts`. Se copia su forma, incluido
el comentario de por qué no pasa por `getEnv()` (preguntar si una feature existe
no puede depender de que TODO el entorno valide).

---

## D2 — La captura del `referral` también va detrás de la bandera

**Decisión**: con la bandera apagada, la ingesta **no** guarda atribución.

**Contra qué**: capturar siempre (el dato llega gratis en el webhook) y usarlo
solo si la bandera está encendida.

**Tensión real**: capturar siempre haría que encender la bandera meses después
tuviera historia que reportar. Pero ADR-001 promete "apagada ⇒ ni rastro", y una
tabla que se llena sola con identificadores de clic de Meta en una instancia que
nunca pidió esa función rompe la promesa por el lado que más importa: el de los
datos.

**Consecuencia aceptada y documentada**: encender la bandera atribuye de ahí en
adelante. No es grave — la ventana de atribución de Meta es de días, no de
meses, así que la historia vieja tampoco sería reportable.

---

## D3 — Los eventos se emiten desde la puerta única de etapas

**Decisión**: `QualifiedLead` y `Purchase` salen desde `moveLeadToStage`, después
del commit de la transacción, best-effort.

**Contra qué**: el diseño del fork, que emite desde donde el bot escribe la ficha
(`/api/bot/ficha`) y desde el servicio de agenda.

**Evidencia (del propio fork, documentada en su bitácora)**: con ese diseño,
*arrastrar* un lead a la etapa "Calificado" en el tablero **no emitía nada**.
Nunca estorbó allá porque en ese negocio quien califica siempre es el bot; en
Vocero, donde el dueño mueve tarjetas a mano y el cerebro puede ser cualquiera,
sería un hueco silencioso: lo peor que le puede pasar a una métrica.

**Por qué es el lugar correcto**: `moveLeadToStage` ya es "la ÚNICA puerta que
escribe `lead.stage_id`", con un test de vigilancia que falla si alguien escribe
etapas por fuera. Colgar de ahí la emisión hereda esa garantía: los cuatro
caminos que mueven un lead reportan igual, y el quinto que alguien agregue
también.

**Cuidado obligatorio**: la emisión va **fuera** de la transacción (después del
commit) y envuelta en `try/catch`. Una llamada de red dentro de la transacción la
mantendría abierta mientras Meta piensa.

---

## D4 — "Lead calificado" es una etapa que elige el negocio

**Decisión**: `capi_settings.qualified_stage_id` — un selector en la pantalla con
las etapas de esa organización. Sin elección, no se emite `QualifiedLead`.

**Contra qué**: (a) cablear el nombre "Calificado"; (b) inferirlo por posición;
(c) un `kind` nuevo en `pipeline_stage`.

**Por qué**: las etapas sembradas de Vocero son Nuevo / En conversación /
Interesado / Cliente / Perdido — **no hay ninguna llamada "Calificado"**, y cada
negocio renombra las suyas. Inferir por posición adivina. Un `kind` nuevo obliga
a migrar el enum y a decidir por el usuario. Un `stage_id` elegido es explícito,
reversible y no toca el modelo del pipeline.

**Por qué la venta NO se configura igual**: `kind = "won"` ya existe, es un ancla
no borrable del pipeline y de él ya cuelga toda la analítica. Pedirle al usuario
que elija otra vez lo que el CRM ya sabe sería puro formulario.

---

## D5 — `events_received` es el único acuse real

**Decisión**: un evento cuenta como enviado **solo** con `events_received >= 1`;
un 200 con cero se registra como fallido, con el `fbtrace_id` en el motivo.

**Evidencia de producción**: Meta responde **200 aunque descarte el evento**
(clid inválido, fuera de ventana, campo mal puesto). Sin mirar el acuse, "enviado"
solo significaría "no hubo error HTTP", y un evento descartado en silencio se
vería idéntico a uno bueno — el modo de fallo más caro posible, porque el negocio
cree que está optimizando y no.

---

## D6 — Cada evento viaja con `custom_data.lead_stage`

**Decisión**: `QualifiedLead` → `{ lead_stage: "qualified" }`; `Purchase` →
`{ lead_stage: "won" }` (más `value`/`currency` si hay monto).

**Evidencia de producción (3 días en cero)**: una conversión personalizada de
Meta solo sabe escribir reglas contra `custom_data` y la URL. `event_name` y
`action_source` **no son parámetros reglables**, y estos eventos no llevan
`event_source_url`. Un evento sin `custom_data` no puede cumplir NINGUNA regla:
la conversión personalizada se queda en cero para siempre y nadie entiende por
qué. Costó tres días descubrirlo; el CRM lo manda de fábrica.

---

## D7 — Se guardan los nombres de Meta, sin traducción interna

**Decisión**: `conversion_event.event_name` guarda `QualifiedLead` / `Purchase`
tal cual, validados contra el catálogo cerrado de `business_messaging`.

**Contra qué**: el esquema del fork, que guarda nombres de dominio propios
(`LeadQualified`, `SessionBooked`) y traduce en la frontera de salida.

**Por qué**: esa traducción existe allá porque su dominio nombró los eventos
antes de leer el catálogo de Meta — y el primer envío real habría muerto en 400.
En un CRM que reporta exactamente dos eventos, una tabla de traducción es una
pieza que solo puede desincronizarse. El catálogo cerrado sí se conserva como
constante: mandar un nombre que no está en él es un 400 opaco, y vale más fallar
antes con un motivo legible.

---

## D8 — `Purchase` sin monto va sin `value`

**Decisión**: si el trato no tiene monto (o es 0), el evento sale sin `value` ni
`currency`.

**Por qué**: `value: 0` no es "no sé cuánto": le enseña al optimizador que las
ventas de este negocio valen cero, que es peor que no decirle nada. La venta se
cuenta igual; solo no se le pone precio. La conversión centavos → unidades
(`4500` → `45.00`) vive en una función pura con test propio: Meta espera unidades
de la moneda y la base guarda centavos enteros.

---

## D9 — `partner_agent: "vocero-crm"`

**Decisión**: constante fija del proyecto.

**Por qué**: Meta usa ese campo para saber qué software integró el evento. El
fork manda su propio nombre, que es exactamente el tipo de cosa que no debe
subir. Ningún fork necesita cambiarlo, pero puede.

---

## D10 — Se prueba de punta a punta contra el mock de Graph

**Decisión**: el mock de Graph aprende `POST {dataset}/events` — valida el nombre
contra el catálogo, exige `ctwa_clid`, y responde `events_received` y un
`fbtrace_id` simulado. Con `datasets` que terminan en `-fail`, responde el 200
mentiroso con `events_received: 0` para ejercitar el camino infeliz.

**Por qué no se prueba contra Meta**: verificado en producción que **no existe
evento sintético**: Meta valida el `ctwa_clid` contra un clic real y devuelve
`code 100 / error_subcode 2804087` con cualquier valor inventado, por bien
formado que esté. Un self-test que dependiera de un anuncio vivo no sería
reproducible por nadie más.

---

## D11 — La actividad es un panel, no un export

**Decisión**: `GET /api/settings/capi/events` con tope duro de 50 filas (25 por
defecto), solo lectura, sin acciones.

**Por qué**: la pregunta que resuelve es "¿esto está funcionando?" y se responde
con las últimas filas. Un export invita a paginación, filtros y un CSV que nadie
mantiene. Si un negocio quiere análisis, tiene su base de datos.
