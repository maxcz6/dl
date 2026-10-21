# specs/

Especificaciones de Vocero CRM. **Esta carpeta no es el mapa completo del
producto** — y saberlo antes de leerla ahorra una confusión.

## Qué hay aquí

| | Carril | Artefactos |
|---|---|---|
| `001-vocero-core` | Ciclo completo | spec, plan, research, data-model, 5 contratos, tasks, checklist |
| `002-diseno-atlas-white-label` | — | spec + plan |
| `003-paridad-inbox-whatsapp` | — | spec |
| `014-canal-instagram` | Ciclo completo | spec |
| `015-motor-agenda-universal` | Ciclo completo | spec, plan, research, data-model, 2 contratos, quickstart, checklist, tasks + la enmienda constitucional que habilitó los conectores |
| `016-atribucion-capi` | Ciclo completo | spec, plan, research, data-model, 2 contratos, quickstart, checklist, tasks |
| `017-canal-messenger` | Ciclo completo | spec (sobre los cimientos de 014: mismo adaptador-por-canal y bandera) |
| `018-anuncio-de-origen` | Ciclo completo | spec, plan, data-model, tasks (puerto de la spec 212 de Vocero Cloud; enmienda la captura de 016) |
| `019-resultados` | Ligero | spec (puerto de la pantalla Resultados de Vocero Cloud, sin gasto publicitario ni migración) |
| `020-token-ia-ui` | Ligero, con el modelo de datos dentro | spec (puerto de `ai_credentials` de Vocero Cloud, #85: Ajustes → IA, migración aditiva `0015`, sin registro de llamadas) |
| `021-despacho-estandar` | Ciclo completo | spec, plan, data-model, 1 contrato, tasks (#89: el CRM le despacha cada turno al cerebro; puerto del despachador de Vocero Cloud, migración aditiva `0016`) |
| `022-canal-tiktok` | Ciclo completo | spec, plan, tasks (TikTok por Zernio sobre los cimientos de 014 y 017; migración aditiva `0018`; la ventana y los límites pasan a declararse por canal) |
| `023-ajustes-canales` | Ligero | spec (pantalla de Instagram, Ajustes → Estado, la cuenta de Zernio resuelta contra la llave, un secreto de firma para todos los canales y el webhook dado de alta por el CRM; puerto de cuatro arreglos de un CRM de cliente, sin migración) |
| `024-texto-social-ventana-humana` | Ligero | spec (el texto de la IA sale sin formato en redes; la ventana humana de 7 días de Instagram y Messenger pasa a ser una capacidad del canal con una sola puerta; puerto de dos specs de un CRM de cliente, sin migración) |
| `026-eliminar-conversacion` | Ciclo completo | spec, plan, tasks (eliminar una conversación o el contacto entero y pedirle al cerebro que la olvide; puerto de Vocero Cloud #106; sin migración, enmienda el contrato del 021 con el evento `conversation.deleted`) |
| `028-pulido-visual` | Ligero | spec (el compositor solo ofrece lo que el canal manda; bandeja vacía y filtro por canal; «multicanal» en menú, pestaña y entrada; un compositor por conversación) |
| `029-agente-no-calla` | Ligero | spec (el agente incluido contesta saludos y «hola, prueba»; solo calla ante un cierre; recordatorio de formato al final del turno; `pnpm eval:silencios` mide contra el modelo real) |
| `027-importar-contactos` | Ligero, con el modelo de datos dentro | spec (importar un CSV de contactos con vista previa y marcar contactos «sin agente»; puerto de Vocero Cloud #108, migración aditiva `0019`) |
| `030-secreto-zernio-cifrado` | Ciclo completo | spec, plan, tasks (el secreto de firma de Zernio de los tres canales sociales pasa a AES-256-GCM; migración aditiva `0020` y los secretos ya guardados se cifran al arrancar la app) |
| `025-despacho-recuerda` | Ciclo completo | spec, plan, tasks (el despacho anota qué mensajes debe; puerto de Vocero Cloud #111, #116 y #117, migración aditiva `0017`; enmienda el contrato del 021) |

Los tres carriles —ciclo completo, ligero y exento— están definidos en el
[Principio VI de la constitución](../.specify/memory/constitution.md). El
criterio no es el tamaño de la feature: es si toca el **modelo de datos** o un
**contrato publicado**.

Lo que se ve arriba es esa gradación en la práctica, antes de que estuviera
escrita: `001` era el producto entero y llevó el ciclo completo; los siguientes
fueron acotándose.

## Dónde está el resto

Entre `003` y la versión 1.2.0 de la app entraron doce features con
comportamiento observable —la API de servicio para un cerebro externo, bitácora
de etapas, alta manual de prospectos, monto, prioridad, ficha del lead, tema
oscuro, responsividad, plantillas multivariable, envío instantáneo, icono de la
pestaña y versión visible— **sin spec en esta carpeta**. Se implementaron antes
de que el Principio VI tuviera un carril intermedio, y esa es la razón, no una
excusa.

Su comportamiento sí está especificado, en dos sitios mejores que un documento
escrito a posteriori:

- **[`tests/e2e/`](../tests/e2e/)** — el comportamiento observable, con sus
  criterios de aceptación. A diferencia de un spec, estos guiones **se
  ejecutan**: cada uno tiene su `scripts/e2e-*.mjs` o se conduce con Playwright.
  Si el código deja de cumplirlos, se pone rojo.
- **El historial de PRs** — el problema que resolvía cada feature, las
  decisiones de diseño con su motivo, y qué se descartó y por qué.

No se van a escribir specs retroactivos para esas trece. Serían una cuarta copia
de algo ya documentado, y la única que nadie ejecuta: la que envejece hasta
contradecir a las otras tres, con el agravante de estar en la carpeta donde uno
espera encontrar la verdad.

## De aquí en adelante

Toda feature declara su carril **antes** de escribir código y deja su `spec.md`
aquí, ciclo completo o ligero. Un spec escrito después de implementar se marca
como tal en su encabezado: es documentación, no diseño, y confundirlos hace
creer dentro de un año que esas decisiones se tomaron antes de programar.
