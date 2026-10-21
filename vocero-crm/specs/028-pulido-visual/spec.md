# 028 — Pulido visual de la 1.6

**Feature Branch**: `feat/028-pulido-visual`

**Created**: 2026-10-14

**Status**: Especificada antes de escribir código. Implementada; gates,
guiones E2E y capturas en verde. D5 y D6 se añadieron al implementar; D7, en la prueba en vivo.

**Input**: séptima spec de la 1.6.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13): «filtro de la bandeja por canal; distintivos de canal con TikTok;
estados vacíos por canal; lo que Kevin liste». Al llegar aquí, dos de los tres
ya estaban hechos: el filtro por canal existe desde la 014 (las píldoras de la
cabecera de la bandeja) y el distintivo de TikTok llegó con la 022. La spec 214
de cloud que el plan daba como referencia no está en el clon de cloud; los
criterios salen de lo que se ve en pantalla.

**Carril**: ligero (Principio VI). Interfaz, más un campo nuevo en el DTO de
conversación de la API interna de la bandeja (no es un contrato publicado:
`/api/bot/*` y el despacho no cambian). Sin modelo de datos.

## Problema

1. **El compositor ofrece lo que el canal no admite.** En Instagram, Messenger
   y TikTok salen el clip, «Enviar ubicación» y «Compartir contacto», igual
   que en WhatsApp. El operador arma el adjunto o llena el formulario, le da
   enviar y el servidor contesta «Este canal no admite ubicaciones ni
   contactos; manda el texto». La interfaz promete algo y el servidor lo
   niega.
2. **La bandeja vacía habla solo de WhatsApp.** «Cuando alguien escriba a tu
   número de WhatsApp…», aunque la instancia tenga Instagram y Messenger
   encendidos.
3. **El filtro de un canal sin conversaciones dice «Sin resultados para este
   filtro»**, que se lee como un error de búsqueda, cuando en realidad nadie
   ha escrito todavía por ese canal.

## Decisiones

**D1 — El compositor enseña solo lo que el canal puede mandar.** Cada canal
declara en sus capacidades si admite ubicación y contactos
(`structuredMessages`; hoy solo WhatsApp) además de adjuntos
(`outboundMedia`, que ya existía). El DTO de conversación lleva las dos
(`composer: { media, structured }`) y el compositor esconde el clip, la
ubicación y el contacto que no apliquen. En las redes queda la caja de texto
sola. La guarda del servidor no cambia: sigue rechazando aunque alguien llame
a la API a mano.

**D2 — La bandeja vacía nombra los canales encendidos.** «Cuando alguien te
escriba por WhatsApp, Instagram o Messenger, su conversación aparecerá aquí en
tiempo real», con la lista que tenga esa instancia. Con solo WhatsApp, el
texto de siempre.

**D3 — Un canal sin conversaciones lo dice así.** Con el filtro de un canal
puesto, sin búsqueda ni otro filtro, y ninguna conversación de ese canal:
«Nadie ha escrito por Instagram todavía.» El resto de los casos vacíos sigue
diciendo «Sin resultados para este filtro.»

**D6 — La etiqueta bajo el logo dice «Multicanal»** (añadido al implementar).
El menú decía «CRM · WhatsApp» con cuatro canales encendidos. Con más de un
canal dice «CRM · Multicanal»; con solo WhatsApp, lo de siempre. La decide el
servidor por `CHANNELS`, igual que la agenda, y la vista previa de Ajustes →
Marca enseña la misma. Lo mismo el título de la pestaña y la pantalla de
entrada: «CRM multicanal con agente de IA» en lugar de «CRM de WhatsApp…».

**D7 — Las iniciales del avatar ignoran los emojis** (añadido en la prueba en
vivo). Los nombres de perfil de Instagram y Facebook traen emojis: «Kevin
Belier 🐏» salía como «K�» (el emoji partido a la mitad) y «Vivir con virtud
⚖️ 🌿» como «V⚖». Las iniciales son la primera letra o cifra de la primera y
la última palabra que tengan alguna.

**D5 — El compositor es uno por conversación** (añadido al implementar). Al
cambiar de conversación se quedaban el borrador, el adjunto elegido y el panel
de ubicación o contacto abierto: un archivo escogido para una persona podía
salir en la conversación de otra, y con D1 un panel de WhatsApp abierto
aparecía en una de Instagram. El compositor se monta de nuevo con cada
conversación.

**D4 — Lo que Kevin liste** entra en una spec aparte, si lo pide; esta no se
queda esperando.

## Código

| Archivo | Qué |
|---|---|
| `src/server/channels/capabilities.ts` | `structuredMessages` por canal |
| `src/lib/types.ts`, `src/server/inbox/queries.ts` | `composer` en el DTO |
| `src/components/inbox/composer.tsx` | D1 |
| `src/components/inbox/conversation-list.tsx` | D2 y D3 |
| `src/components/inbox/inbox-client.tsx` | D5 |
| `src/lib/utils.ts` (`initials`) | D7 |
| `src/lib/channels.ts` (`navKicker`), `src/app/(app)/layout.tsx`, `app-shell.tsx`, `app-nav.tsx`, Ajustes → Marca | D6 |

## Pruebas

- **Unitarias**: capacidades (solo WhatsApp admite ubicación y contactos) y el
  texto de la bandeja vacía según los canales encendidos.
- **Guiones E2E**: `e2e-ventana-social` (bandeja de Instagram y Messenger)
  comprueba que el DTO de una conversación social trae `composer` en falso y
  la de WhatsApp en verdadero; los demás siguen en verde.
- **Capturas** en claro y oscuro con Playwright: el compositor en WhatsApp y en
  Instagram, la bandeja vacía con varios canales y el filtro de un canal sin
  conversaciones. `tests/unit/contraste-temas.test.ts` en verde.
- **En vivo**: en `vocero-clase`, abrir la conversación de Instagram y ver el
  compositor sin clip, ubicación ni contacto (captura).

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I · Seguridad | Sin secretos ni datos nuevos |
| II · Soberanía | Sin dependencias nuevas |
| III · Multi-tenancy | Sin consultas nuevas |
| IV · Idempotencia | No toca escritura |
| V · Calidad | Cuatro gates, unitarias, guiones y capturas en los dos temas |
| VI · Specs | Este documento, antes del código; carril ligero declarado |
| VII · Trazabilidad | D1 a D4; bitácora al cerrar |
| VIII · Foco | La bandeja multicanal |
| IX · En vivo | Lo descrito arriba |
