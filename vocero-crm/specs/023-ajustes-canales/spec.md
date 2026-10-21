# 023 — Ajustes → Canales y arreglos de Zernio

**Feature Branch**: `feat/023-ajustes-canales`

**Created**: 2026-10-13

**Status**: Especificada antes de escribir código. Implementada; gates y
guiones E2E en verde. Probada en vivo contra Zernio real con la imagen
`1.6.0-rc.1` (bitácora). **Pendiente de verificación humana:** un mensaje
directo real a Instagram y otro a la página con esa imagen.

**Input**: tercera spec de la 1.6.0 (`PLAN-2.0.md`, aprobado por el dueño el
2026-10-13). Puerto de cuatro arreglos que megaparty-crm ya probó con un
cliente (`dbb97a6`, `b761069`, `ac6ec05`, `9b1a0b6`) y de la parte de salud de
Zernio de su spec 123. Las formas de `GET /accounts` y `GET /webhooks/settings`
se leyeron de la API real el 2026-10-13.

**Carril**: ligero (Principio VI). No toca el modelo de datos (ninguna
migración) ni un contrato publicado: `/api/bot/*`, el despacho y los webhooks
no cambian de forma. Todo lo nuevo es interno (`/api/settings/*`, con sesión).

## Problema

Conectar un canal social hoy tiene cuatro trampas, y las cuatro ya le costaron
horas a alguien:

1. **Instagram no tiene pantalla.** `PUT /api/settings/instagram` existe desde
   la 014 y el webhook también, pero el canal solo se conecta llamando a la API
   a mano. `/settings/instagram` da 404 con el canal encendido.
2. **Zernio enseña dos ids que parecen iguales**: el del perfil (el contenedor)
   y el de cada cuenta. Los webhooks enrutan por el de la cuenta. Quien pega el
   del perfil ve el webhook responder 200 y cada mensaje descartado en silencio.
3. **Un webhook de Zernio firma con un solo secreto**, y el CRM guarda uno por
   canal. Si al capturarlos no quedan iguales, un canal rechaza todo con 401.
4. **No hay dónde ver si un canal está vivo.** Una cuenta que Zernio marca para
   reconectar, un webhook desactivado por fallos o una cuenta de TikTok que no
   es Business se descubren cuando un cliente dice que nadie le contestó.

## Decisiones

**D1 — La cuenta se resuelve contra Zernio, no se copia.** Al guardar una
conexión por Zernio (Instagram, Messenger o TikTok), el CRM lee `GET /accounts`
con esa llave (que además la valida) y decide qué cuenta es:

| Lo que llega en `accountRef` | Resultado |
|---|---|
| El id de una cuenta de ese canal | Se guarda |
| Vacío, y la llave tiene una sola cuenta de ese canal | Se toma esa |
| Vacío, y hay varias | 422 `choose_account` con las candidatas (id y nombre) |
| El id del perfil, con una sola cuenta de ese canal dentro | Se guarda el de la cuenta |
| El id de una cuenta de otra red, o uno que no existe | 422 `unknown_account`, diciendo cuáles sirven |

Del mismo sitio salen el nombre que se enseña y, en Instagram, el `igUserId`
(`platformUserId`): en modo Zernio ya no se pide. En Messenger salen la página
y su nombre. Con la fuente Meta nada cambia.

**D2 — Una fila con el id del perfil se corrige sola.** Si llega un evento cuyo
`account.id` no tiene conexión pero su `account.profileId` sí, la fila se
actualiza al id de la cuenta en ese momento (el envío usa el mismo campo). Es
para instalaciones anteriores a D1.

**D3 — Vale cualquier secreto de Zernio de la organización.** La firma se
prueba contra los secretos guardados en sus canales con fuente Zernio. Si
ninguno coincide, contra los de los webhooks de Zernio que apuntan a esta
instancia (se reconocen porque su URL lleva el segmento secreto), leídos de
`GET /webhooks/settings` con la llave guardada. Esa lectura se guarda 10
minutos; un fallo, 1 minuto. Si la firma no coincide con lo leído y la lectura
tiene más de un minuto, se relee: es lo que tarda el CRM en enterarse de que
el secreto cambió en Zernio, y el tope de consultas que puede provocar quien
mande firmas inválidas. Sin ningún secreto en ningún lado, la capa sigue
apagada y protege el segmento secreto de la URL, como hoy.

**D4 — El CRM da de alta su webhook en Zernio.** Al guardar una conexión por
Zernio, y con un botón para reintentar, el CRM crea o actualiza **un** webhook
por llave: evento `message.received`, **limitado a las cuentas conectadas a
esta organización**, con un secreto que genera y guarda en esos canales. Solo
toca webhooks que ya apuntan a esta instancia; los demás no se leen más que
para contarlos. Si Zernio falla, la conexión se guarda igual y el fallo se
dice. El campo «secreto del webhook» sale de las pantallas: la API lo sigue
aceptando (el que llega manda sobre los guardados y queda en todos los canales
y en Zernio), y si no llega se conserva el que ya había.

**D5 — Pantalla Ajustes → Canales → Estado** (`/settings/channels`). Una fila
por canal encendido, WhatsApp incluido:

- **Conexión**: conectado o no, por qué fuente y con qué cuenta.
- **Última entrada**: cuándo llegó el último mensaje de un cliente por ese canal.
- **Salud**, solo con fuente Zernio y consultada al abrir la pantalla: la
  cuenta (activa, pide reconectar, restringida; en TikTok, si es Business) y el
  webhook (hay uno activo hacia esta instancia que cubre esa cuenta, cuántos
  fallos lleva, cuándo disparó por última vez). Con fuente Meta se enseña el
  estado guardado, que cambia cuando un envío falla por credenciales.

Existe solo si hay algún canal social encendido (ADR-001): con WhatsApp solo,
su pantalla ya dice todo.

**D6 — Pantalla de Instagram** (`/settings/instagram`), gemela de la de
Messenger y con las mismas reglas. Dice de frente lo que más confunde: no
necesita página de Facebook vinculada y los comentarios no entran a la bandeja.

**D7 — Conectar Instagram es cosa del propietario.** `PUT
/api/settings/instagram` no revisaba el rol; Messenger y TikTok sí. Ahora los
tres responden 403 a quien no sea propietario.

## Fuera de alcance

| Qué | Dónde |
|---|---|
| Vincular las redes desde Vocero (OAuth) | No: se vinculan en Zernio, con la cuenta del negocio |
| Texto sin formato de WhatsApp en redes y ventana humana | Spec 024 |
| Filtro de la bandeja por canal y estados vacíos | Spec 028 |
| Alertas cuando un canal se cae | No se porta (spec 129 de megaparty) |
| Salud en vivo de un token de Meta | El estado guardado alcanza; se revisa si alguien lo pide |

## API interna (sesión)

| Ruta | Cambio |
|---|---|
| `PUT /api/settings/instagram` · `messenger` · `tiktok` | En modo Zernio `accountRef` es opcional y se resuelve (D1). 422 `choose_account` trae `error.details.accounts: [{ id, name }]`. La respuesta gana `webhook: { ok, created?, message? }` (D4). Instagram: `igUserId` opcional en modo Zernio; 403 si no es propietario |
| `GET /api/settings/channels` | Nuevo. `{ channels: [{ channel, connected, source, account, status, lastInboundAt, health }], webhook }` |
| `POST /api/settings/channels` | Nuevo, solo propietario. Da de alta o actualiza el webhook en Zernio (D4) |

## Código

| Archivo | Qué |
|---|---|
| `src/server/zernio/cuentas.ts` (nuevo) | `fetchZernioAccounts`, `pickZernioAccount` (puro), `accountHealth` (puro) |
| `src/server/zernio/webhooks.ts` (nuevo) | Listar webhooks con caché, cuáles apuntan aquí (puro), secretos, `ensureZernioWebhook` |
| `src/server/zernio/conexiones.ts` (nuevo) | Las conexiones Zernio de una organización en una sola forma, y guardar el secreto en todas |
| `src/server/zernio/index.ts` · `dispatch.ts` | `isValidZernioSignatureAny`; `resolveZernioSecret` devuelve `secrets` (D3) |
| `src/server/{instagram,messenger,tiktok}/credentials.ts` · `ingest.ts` | `get…CredentialsForZernio` (D2) |
| `src/app/api/settings/{instagram,messenger,tiktok}/route.ts` | D1, D4, D7 |
| `src/app/api/settings/channels/route.ts` (nuevo) · `src/server/channels/status.ts` (nuevo) | D5 |
| `src/components/settings/{instagram,channels}-client.tsx` (nuevos), `messenger-client.tsx`, `tiktok-client.tsx`, `src/lib/nav.ts`, páginas | D4, D5, D6 |
| `src/app/api/dev/zernio-mock`, `src/server/dev/zernio-mock-state.ts` | El simulador sirve `/accounts` y `/webhooks/settings` |

## Pruebas

- **Unitarias**: `pickZernioAccount` (las cinco filas de D1), `accountHealth`,
  `isValidZernioSignatureAny`, qué webhooks apuntan aquí y cuál cubre una
  cuenta, las secciones de la navegación.
- **Guion `scripts/e2e-canales.mjs`** contra la app con simuladores: conectar
  Instagram sin `accountRef`; con el id del perfil; con una cuenta de otra red;
  varias cuentas → `choose_account`; no propietario → 403; el webhook queda
  creado y limitado a las cuentas; firma válida → 200 e inválida → 401 con el
  secreto solo en Zernio; un secreto para dos canales; autocuración del id de
  perfil; `GET /api/settings/channels` con una cuenta sana, una que pide
  reconectar y un TikTok personal.
- Los guiones existentes (`e2e-messenger`, `e2e-tiktok`, `e2e-despacho`,
  `e2e-selftest`) siguen en verde con el simulador ampliado.
- **Interfaz**: las tres pantallas en local, claro y oscuro.
- **En vivo** (Principio IX): en la instancia `vocero-clase`, reconectar
  Instagram y Messenger por la API con la llave real, ver el webhook de Zernio
  actualizado y limitado, recibir el evento de prueba firmado por Zernio (200)
  y uno con la firma rota (401), y leer el estado de los canales. Un mensaje
  directo real por cada red lo tiene que mandar una persona.

## Constitution Check

| Principio | Cómo se cumple |
|---|---|
| I · Seguridad | La llave y el secreto siguen cifrados o solo en servidor; hacia fuera, la cola de la llave. El secreto de Zernio nunca sale en una respuesta. D7 cierra un hueco de rol. La firma no se relaja: se prueba contra más secretos legítimos, nunca contra menos |
| II · Soberanía | Zernio sigue siendo un conector opcional con la cuenta del negocio; sin canales sociales nada de esto existe |
| III · Multi-tenancy | Toda lectura va por `organizationId` de la sesión o por la cuenta del evento; el webhook se limita a las cuentas de esa organización |
| IV · Idempotencia | Dar de alta el webhook dos veces actualiza el mismo; la deduplicación de mensajes no cambia |
| V · Calidad | Cuatro gates, unitarias y guion E2E |
| VI · Specs | Este documento, antes del código; carril ligero declarado |
| VII · Trazabilidad | Decisiones D1 a D7 aquí; bitácora al cerrar |
| VIII · Foco | Es la conexión de canales de conversación, nada más |
| IX · En vivo | Lo descrito arriba; lo que requiere a una persona queda marcado |
