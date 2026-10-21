# Bitácora — Vocero 1.6 y 2.0

Qué se hizo, cómo se probó y dónde vive cada cosa. Una entrada por spec.
Nunca valores de secretos: como mucho, sus últimos 4. El plan está en
`PLAN-2.0.md` del espacio de trabajo del autor; las specs, en `specs/`.

## 2026-10-13 — 025: el despacho recuerda qué debe

**PR**: [#111](https://github.com/kevinrivm/vocero-crm/pull/111), rama
`feat/025-despacho-recuerda`. Spec antes del código (`94e5457`); la
implementación en `c083037`; un arreglo del selftest en `b91e0dc`.

### Qué quedó

- Puerto de Vocero Cloud #111 (`439386e`), #116 (`5325273`, `2fdeff2`) y #117
  (`2624262`). La raíz ya traía el #111 desde el 021 (`hayMensajesSinDespachar`):
  faltaba la memoria.
- Migración `0017_dispatch_message_ids`: una columna `jsonb` nula.
- Con cerebro externo, el despacho anota qué entrantes debe y los entrega
  aunque después haya una respuesta del agente. Un despacho sin mensajes se
  descarta («sin mensajes por despachar»).
- **Diferencia con cloud, decidida aquí**: en la raíz el agente incluido no
  pasa por el outbox. Lleva la misma cuenta en su coalesce (en memoria, como su
  `pending`), lee lo debido después de su propia respuesta y devuelve qué
  leyó.
- **Decisión que Kevin no ha revisado para la raíz**: si el operador contesta
  desde la bandeja dentro de la ventana de agrupado, el agente incluido ya no
  contesta encima (spec, AC5b). En cloud lo confirmó el 12-oct; con el
  despacho la raíz ya se comportaba así.

### Cómo se probó

| Qué | Resultado |
|---|---|
| `typecheck`, `lint`, `test`, `build` | Verdes con banderas apagadas y con `CHANNELS` + `AGENDA`. 1 017 unitarias. CI del PR: 3 de 3. |
| `scripts/e2e-despacho.mjs` con cerebro | 89/89, tres corridas. Sin el arreglo, 84/89: las rojas son las de «mientras piensa». La de «persona en la ventana» ya pasaba en la raíz: queda como regresión. |
| `scripts/e2e-despacho.mjs` con el agente incluido | 14/14, tres corridas. Sin el arreglo, 11/14: el orden del turno y las dos de «no contesta encima». |
| `scripts/e2e-selftest.mjs` sin `BRAIN_DISPATCH_URL` | 213/213 en frío sobre una base nueva; `dispatch` queda vacía. |
| Migración | Base vacía; y base en `0016` con un despacho pendiente: `0017` en dos pasadas, la fila queda con `message_ids` nulo y se entrega igual. |
| En vivo, local | Ver abajo. |
| En vivo, Coolify | Ver abajo. |

Tres carreras de los guiones contra la ingesta salieron al repetir corridas, y
ninguna era del producto: la ráfaga de cinco mensajes (se guardaban en otro
orden), la ventana de 24 h tras un botón, y la pausa tras un eco. Las tres se
arreglaron esperando el hecho en vez de un tiempo fijo. El mock de WhatsApp
repetía ids al reiniciar su bandeja dentro del mismo proceso; ya no.

Queda apuntado, fuera de esta spec: el producto ordena los mensajes por hora
de inserción, no por la hora del canal. Dos webhooks de la misma conversación
procesados a la vez pueden guardarse en otro orden.

### Prueba en vivo

Número «Soporte» (…9518, coexistencia) y línea cliente (…9768) por Evolution.
Contesta el agente incluido con el negocio demo y `openai/gpt-4o-mini` por
OpenRouter. Nea contra la raíz por despacho llega con nea-agent#37.

**La raíz no tiene lista de permitidos** (`ALLOWED_WA_IDS` es de Nea). Para que
el agente de pruebas solo le contestara a la línea cliente, el override apuntó
a un relevo local detrás de un túnel de Cloudflare: lo de la línea cliente va
al CRM de pruebas y todo lo demás se reenvía, crudo y con su firma, a donde
apuntaba el override. En las dos ventanas solo pasó tráfico de la línea
cliente.

| | Local (`next start`, commit `b91e0dc`) | Coolify (`vocero-16`, commit `b91e0dc`) |
|---|---|---|
| Override movido (UTC) | 18:48:05 | 18:54:18 |
| Override devuelto (UTC) | 18:49:28 | 18:54:46 |
| Intento 1 | 2.º mensaje a los 4.0 s: misma ventana, una respuesta a los 15.4 s que contesta las dos preguntas | 2.º mensaje a los 7.0 s, con el modelo pensando; respuestas a los 9.1 s (horario) y 12.8 s (envíos) |
| Intento 2 | 2.º mensaje a los 7.0 s, con el modelo pensando; respuestas a los 10.3 s y 14.0 s | — |

El override del número apuntaba a un demo de la clase
(`nea-comida.177.7.62.92.sslip.io`) y ahí volvió las dos veces; se comprobó
antes de moverlo que contesta el reto de verificación, y después de devolverlo
que lo sigue contestando. El de la WABA (`vocero-clase.kevinbelier.cloud`) y el
webhook de la app no se tocaron: al guardar la conexión, el CRM de pruebas vio
el override de la WABA y no registró el suyo.

Seis mensajes de la línea cliente y cinco respuestas del agente en total. El
gasto de OpenRouter no se midió: cinco turnos de `gpt-4o-mini` con el prompt
del demo, del orden de una fracción de centavo. El Laboratorio no se corrió.

**En Coolify el webhook llegó por el relevo, no directo de Meta.** Lo que queda
sin probar es solo ese salto; la verificación de Meta (`hub.challenge`) sí la
contestó la instancia.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Proyecto Coolify `vocero-16` | `cz6ssrdhn2pfuzkkmjwm0drq`, entorno `production` (`qnk5mqg4pzxzbfolg95vnmfq`) |
| Servicio `vocero16-crm` (app + Postgres) | `rwzjzhsi5boaujr25snbjuxe`; app `zit4a8bggjnhuwympeonvera`, base `jrur7xgv1oluirvyhlqfpedu` |
| URL | `https://vocero16.177.7.62.92.sslip.io` (healthcheck de Coolify apagado en el compose) |
| Servidor | `sd6cdcmljjxi5sufn6d0bzey`, el único del panel. **`COOLIFY_SERVER_UUID` de la bóveda trae otro valor y no existe en ese panel**: hay que corregirlo. |
| Secretos de la instancia (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, verify token, contraseña de Postgres) | Los generó Coolify (`SERVICE_PASSWORD_*`, `SERVICE_REALBASE64_*`); viven solo en el servicio. No pasaron por el chat. |
| Llave de OpenRouter de la instancia | Cifrada en su base (Ajustes → IA). Sale de `LLM_API_KEY` de la bóveda. |
| Token de WhatsApp de la instancia | Cifrado en su base. Sale de `WA_TOKEN` de la bóveda. |
| Dueño de la instancia | Correo `OWNER_EMAIL` de la bóveda; contraseña en `.env.vocero16` del espacio de trabajo. |
| Override original del número | `.override-soporte.json` del espacio de trabajo (su último tramo es un secreto). |
| Guiones de la prueba en vivo | `ops/` del espacio de trabajo: `override.mjs`, `relay.mjs`, `evolution.mjs`, `vivo.mjs`. Fuera de este repo. |
| Local | Postgres propio en Docker (`vocero-20-pg`, puerto 5433): bases `vocero_025_*`. `.env.e2e-*` y `.env.vivo` en el clon, ignorados por git. |

Al levantar el compose de desarrollo, Docker recreó el contenedor del Postgres
compartido de la máquina (`vocero-dev-postgres-1`) sobre su mismo volumen: sus
bases siguen ahí y no se usó (tiene otra contraseña). Las pruebas corrieron en
el Postgres propio.

El agente incluido de la instancia de Coolify quedó **apagado** y su número
conectado. Se reutiliza para las pruebas en vivo de 022 a 028.

Para repetir la prueba: `node ops/relay.mjs 3281 <url>`, túnel a `:3281`,
`node ops/override.mjs mover <túnel> <env> [url]`,
`node ops/vivo.mjs dos-mensajes <url> <env>`, `node ops/override.mjs devolver`.

### Qué sigue

022, canal TikTok por Zernio.

## 2026-10-13 — 022: canal de TikTok por Zernio

**PR**: [#112](https://github.com/kevinrivm/vocero-crm/pull/112), rama
`feat/022-canal-tiktok`. Spec antes del código (`b32d4da`); implementación en
`6bd9b4d`. **Abierto, sin mergear**: falta la prueba en vivo.

### Qué quedó

- `tiktok` es un canal más, opcional (`CHANNELS`), con Zernio como única
  fuente: tabla `tiktok_credentials` (migración `0018_canal_tiktok`), adaptador
  `src/server/tiktok/`, webhook `/api/webhooks/tiktok/<token>`, Ajustes →
  TikTok, distintivo y filtro en la bandeja. Identidad `tt:<id>`.
- Los límites de TikTok se declaran en las capacidades del canal y el envío
  los comprueba antes de llamar a Zernio: ventana de 48 h sin forma de reabrir
  (409 `window_closed`), 10 salientes desde el último entrante (409
  `message_limit`, nuevo en `/api/bot/messages`) y 6,000 caracteres.
- Dos cambios del núcleo que el canal obligó a hacer: la ventana se pregunta
  por canal (`windowMsFor`) en la bandeja, en `/api/bot/context` y en el
  despacho; y el tope de 4,096 caracteres dejó de ser uno global en el esquema
  de la API para declararse en WhatsApp. Los demás canales no cambian.
- `sendZernioMessage` lee `data.messageId`, que es donde la API real devuelve
  el id. El mock respondía con otra forma y la raíz guardaba un id inventado
  para Instagram y Messenger por Zernio.

### Decisiones que Kevin no ha revisado

- **La imagen saliente quedó fuera** (spec, D9), aunque la fila del plan la
  enumeraba. Zernio la acepta como URL pública o `multipart`; la raíz no
  expone sus adjuntos sin sesión y la documentación no nombra el campo del
  `multipart`. Ningún canal social de la raíz envía adjuntos todavía.
- **Si el agente topa con el tope de 10, calla sin traspasar** (D7).
- **WhatsApp: el límite de 4,096 se movió del esquema de la API al canal**
  (D11). Sigue respondiendo 422; cambia el texto del error.

### Cómo se probó

| Qué | Resultado |
|---|---|
| `typecheck`, `lint`, `test`, `build` | Verdes en las dos configuraciones; la completa ya incluye `tiktok`. 1 040 unitarias. CI del PR: 3 de 3. |
| `scripts/e2e-tiktok.mjs` | 52/52, dos corridas sobre el código final, contra el mock de Zernio: conexión, firma, dedup, agente, operador, el undécimo mensaje, 6,000 caracteres, 30 y 49 horas, descartes y reparto por plataforma. |
| `scripts/e2e-despacho.mjs` | 94/94 con cerebro (sección nueva: `channel: "tiktok"`, `tt:`, `windowExpiresAt` a 48 h) y 14/14 con el agente incluido. |
| `scripts/e2e-messenger.mjs` · selftest | 42/42 · 213/213. |
| Migración | Base vacía; la que venía de `0016`/`0017` con su despacho pendiente; y la instancia de Coolify, que conservó sus 9 conversaciones. |
| Interfaz | Ajustes → TikTok, distintivo, filtro y compositor con la ventana cerrada, vistos en el navegador contra la app local. |
| Coolify | `vocero-16` sirve `6bd9b4d` con `CHANNELS=whatsapp,tiktok`. La cuenta se conectó desde la API de ajustes: la llave se validó contra el Zernio real. |
| **En vivo** | **Pendiente de verificación humana.** |

### Por qué falta la prueba en vivo

En Zernio, la cuenta `kevin.belier` de TikTok figura como **personal**
(`tiktokAccountType: personal`, conectada el 13-oct). TikTok solo permite
mensajes directos por API a cuentas **Business**: mientras siga así no llega
ningún webhook. Además hace falta que una persona mande el DM (TikTok no deja
que el negocio inicie). Lo que falta, en orden:

1. Pasar `@kevin.belier` a cuenta Business en TikTok, con los mensajes
   directos abiertos, y reconectarla en Zernio si este no refleja el cambio.
2. Dar de alta en Zernio el webhook de la instancia, **acotado a esa cuenta**
   (`accountIds`), con el evento `message.received` y el secreto que ya está
   en `.env.vocero16`. La llave de Zernio también sirve cuentas de clientes y
   ya hay un webhook de equipo hacia el CRM de uno de ellos: sin `accountIds`,
   los DMs de esas cuentas llegarían a la instancia de pruebas.
3. Encender el agente de `vocero-16` solo durante la prueba: la raíz no tiene
   lista de permitidos y contestaría a cualquiera que escriba a esa cuenta.
4. Un DM desde un TikTok personal: entra a la bandeja, el agente contesta, el
   operador responde, y el undécimo mensaje se rechaza con 409.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | La misma de la 025 (`vocero16-crm`, `rwzjzhsi5boaujr25snbjuxe`), ahora desde la rama `feat/022-canal-tiktok`, con el agente apagado. |
| Cuenta de TikTok en Zernio | `6ace6bfe5d6259b1df1e1bf2` (`@kevin.belier`), perfil «Kevin Belier». |
| Llave de Zernio de la instancia | Cifrada en su base (Ajustes → TikTok). Sale de `ZERNIO_API_KEY` de la bóveda. |
| Secreto del webhook de TikTok | `TIKTOK_WEBHOOK_SECRET` en `.env.vocero16` del espacio de trabajo, y en la tabla `tiktok_credentials` de la instancia (sin cifrar, igual que el de Instagram y el de Messenger). |
| Guiones | `ops/zernio.mjs` (solo enseña las cuentas de Kevin) y `ops/vivo.mjs tiktok | estado`. |
| Local | Bases `vocero_022_tiktok` y `vocero_022_cerebro` en `vocero-20-pg`; `.env.e2e-tiktok` y `.env.e2e-cerebro22` en el clon. |

No se creó ningún webhook en Zernio ni se tocó ninguna cuenta que no sea la de
Kevin.

### Qué sigue

La prueba en vivo de la 022 cuando la cuenta sea Business; después, 023.

## 2026-10-13 — 1.5.1, la clase multicanal y el starter 2.2.0

Escrito después de los hechos: fue un día de clase y la bitácora quedó para el
final.

### Versión 1.5.1

PR #113 (`dad742f`), tag `v1.5.1`, imagen `ghcr.io/kevinrivm/vocero-crm:1.5.1`
y release en GitHub. Saca la 025 antes que la 1.6.0, junto con el despacho al
cerebro que ya estaba en `main`.

### 022, TikTok

PR #112 abierto, sin mergear. Verde con simuladores (`e2e-tiktok` 52/52, dos
corridas). **Pendiente de verificación humana:** `@kevin.belier` es cuenta
personal y TikTok solo entrega mensajes por API a cuentas Business; la
solicitud de Kevin está en revisión.

### Demo de la clase (instancia `vocero16-crm`, ya borrada)

- La instancia de pruebas pasó a la imagen `1.5.1` con
  `CHANNELS=whatsapp,instagram,messenger` y el agente incluido encendido.
- **Dominio:** con permiso expreso de Kevin, `vocero-clase.kevinbelier.cloud`
  se le quitó a la app `vocero-crm` del proyecto `vocero` (instalación anterior
  del starter) y se le dio a la demo. Después de la demo se liberó para la
  instalación del starter.
- **WhatsApp «Soporte»:** el override del número se movió de la Nea del demo de
  comida a la demo (20:58 UTC) y se reapuntó al cambiar el dominio (~21:03
  UTC). **No se devolvió**: al terminar se quitó (~22:15 UTC) porque el número
  pasó a la instalación de la clase, por decisión de Kevin. El original sigue
  en `.override-soporte.json`.
- **Zernio:** webhook `vocero-16-clase` (`6ace9b814a6701990705765e`), limitado
  al Instagram y a la página de Kevin; desactivado al terminar.
- **Probado en vivo:** WhatsApp, entrada y respuesta del agente en 11 s.
  Instagram y Messenger: conexión y evento de prueba de Zernio en 200; los DM
  reales los mandó Kevin en la clase, no quedaron medidos aquí.
- Observado y sin investigar: con dos preguntas seguidas por WhatsApp, el
  modelo las leyó en el mismo turno y contestó solo la primera.

### Starter 2.2.0

Repo local `Vocero-cloud astra/vocero-starter-v2` (sin remoto), commit
`a7b8de7`, tag `v2.2.0`, zip al lado. Agrega `CHANNELS` y `AGENTE` al `.env`,
las skills `conectar-canales` y `agente-incluido` y el guion `canales.mjs`.
Ensayado contra Zernio real y una instancia aparte (`ensayo-starter-crm`, ya
borrada). Kevin lo corrió completo en la clase: de ahí salió la instalación
que queda.

### Qué queda en Coolify

| Qué | Dónde |
|---|---|
| Instalación de la clase (se queda como instancia de pruebas) | Proyecto `vocero-clase` (`yyojx68tpzqbyrlfglhstbbn`): app `vocero-crm` (`3jinuviignszpotzzmvs6nrf`), base `vocero-clase-db` (`apppb0cmt0hwzzyoe8z6a699`). `https://vocero-clase.kevinbelier.cloud`, imagen `1.5.1`, tres canales |
| Sus secretos | En el `.env` del starter de Kevin (`Downloads/vocero-starter-v2`) y en las variables de la app. La bóveda del espacio no los tiene |
| WhatsApp «Soporte» | Override de la WABA hacia `vocero-clase…`; sin override en el número |
| Proyectos `vocero-16` y `vocero` | Vacíos |

**Borrado (noche del 13 al 14, hora UTC; con volúmenes):** servicios `vocero16-crm` y
`ensayo-starter-crm`; del proyecto `vocero`, las apps `vocero-crm`
(`anhoehhz…`) y `nea` y las bases `vocero-db` y `nea-db`. Se hizo **por la API
de Coolify y no por el MCP**, con autorización expresa de Kevin: el MCP
devolvía «el usuario rechazó» sin mostrarle el diálogo. Guion
`ops/borrar-coolify.mjs`, de lista cerrada. Los tres demos multinicho no se
tocaron.

El demo de comida se quedó sin WhatsApp: su número es ahora el de la
instalación de la clase.

### Qué sigue

Poner la 022 al día con `main` y empezar la 023 (Ajustes → Canales).

## 2026-10-13 — 023: Ajustes → Canales y arreglos de Zernio

PR #115. Carril ligero, sin migración. Spec escrita antes del código
(`specs/023-ajustes-canales/spec.md`).

También se mergeó la 022 (PR #112) con su prueba en vivo **pendiente de
verificación humana**: TikTok no entrega mensajes por API a la cuenta personal
de prueba. El canal va apagado por defecto y el CHANGELOG lo dice.

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,069 unitarias |
| `scripts/e2e-canales.mjs` (nuevo) | 73/73, en una base nueva y repetido sobre la misma |
| `e2e-messenger` · `e2e-tiktok` | 42/42 · 52/52 |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-selftest` | 213/213 |
| Interfaz en local | Estado, Instagram, Messenger y TikTok en claro y oscuro; Estado e Instagram en móvil (sin desbordar); elegir entre varias cuentas; reparar el webhook. Capturas con Playwright |

El guion encontró un fallo de diseño antes de salir: con la lectura de los
webhooks de Zernio guardada 10 minutos, un secreto que cambiara en Zernio
dejaba al CRM rechazando entregas todo ese tiempo. Ahora, si la firma no
coincide, se relee como mucho una vez por minuto (`WEBHOOKS_RECHECK_MS`), con
su prueba unitaria.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.1`)

Para probar una rama en una instancia que corre desde imagen se publicó un
**prelanzamiento**: tag `v1.6.0-rc.1` sobre el commit `53afca9` de la rama.
Publica `ghcr.io/kevinrivm/vocero-crm:1.6.0-rc.1`; `latest` y `1.5.1` no se
movieron (se comprobó por digest). `/api/health` sigue diciendo `1.5.1` porque
`package.json` no se tocó: lo que distingue la imagen es el commit.

Con la llave real de Zernio y las cuentas de Kevin:

- `PUT /api/settings/instagram` y `messenger` **sin `accountRef`** → 200, con
  la misma cuenta que ya había y su nombre (Messenger no lo tenía guardado).
- En Zernio sigue habiendo **un** webhook hacia la instancia (el que creó el
  starter): activo, `message.received`, sus dos cuentas. Los otros cuatro
  webhooks de la llave quedaron igual.
- Entrega firmada con el secreto que tiene Zernio → 200; firma rota → 401;
  sin firma → 401. El evento de prueba de Zernio llegó sin registrar fallos.
- `GET /api/settings/channels`: los tres canales conectados, con su último
  mensaje y cuenta y webhook sanos; sin llave ni segmento del webhook en la
  respuesta.
- WhatsApp: un mensaje real de la línea cliente (Evolution) entró y el agente
  contestó (`delivered`).

**Pendiente de verificación humana:** un mensaje directo real a Instagram y
otro a la página, desde una cuenta personal, ya con esta imagen. Las pantallas
en la instancia viva tampoco se abrieron (entrar con contraseña a un sitio que
no es local no lo hace el asistente): se revisaron en local.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | Proyecto Coolify `vocero-clase` (`yyojx68tpzqbyrlfglhstbbn`), app `3jinuviignszpotzzmvs6nrf`, etiqueta de imagen `1.6.0-rc.1` desde el 2026-10-14 00:43 UTC |
| Credenciales del dueño de la instancia | `.env` de la carpeta del starter de Kevin; los guiones las leen de ahí (`ops/clase.mjs`) y guardan solo la cookie de sesión en el espacio de trabajo |
| Secreto de firma de Zernio | En la columna `webhook_secret` de las credenciales de cada canal y en el webhook de Zernio. Nunca sale en una respuesta de la API. **Esa columna va sin cifrar desde la 014** (el token sí va cifrado): queda anotado para cifrarla con una migración |
| Guiones de esta prueba | `ops/vivo-023.mjs` (`salud`, `estado`, `reconectar`, `webhook`, `firma`, `whatsapp`, `ajenos`), fuera del repo |
| Local | Base `vocero_023_canales` en el Postgres propio (5433); `.env.e2e-canales` en el clon, ignorado por git |

Visto de paso y sin tocar: la llave de Zernio de Kevin tiene un webhook activo
de otro CRM **sin límite de cuentas**, así que también recibe los eventos de
sus cuentas personales. Es justo el caso que el límite por cuentas de esta spec
evita en las instalaciones nuevas.

### Qué sigue

024, texto social sin formato de WhatsApp y ventana humana.

## 2026-10-13 — 024: texto de la IA en redes y ventana humana

PR #116. Carril ligero, sin migración. Spec escrita antes del código
(`specs/024-texto-social-ventana-humana/spec.md`).

Dos cosas se decidieron distinto de como venían en el plan, y quedan dichas en
el spec:

- La etiqueta de la bandeja es **«ventana humana»**, no «atención humana»: ese
  nombre ya es el traspaso a una persona (con la IA en pausa) y los dos
  estados se confundían en la misma pantalla.
- Entre 24 horas y 7 días, en Instagram y Messenger, **la IA ya no envía**
  (`/api/bot/messages` → 409 `window_closed`). Antes enviaba con la etiqueta
  de agente humano, que Meta reserva a personas. Es lo que `windowOpen` y el
  contrato del despacho ya decían; el contrato ganó dos frases que lo aclaran.

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,095 unitarias |
| `scripts/e2e-ventana-social.mjs` (nuevo) | 53/53, en base limpia y repetido |
| `e2e-canales` | 73/73 en base limpia y 73/73 sobre una base ya usada |
| `e2e-messenger` · `e2e-tiktok` | 42/42 · 52/52 |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-selftest` | 213/213 |
| Bandeja en local | Instagram con la ventana abierta, humana (30 h) y cerrada (8 días), en claro y oscuro. Capturas con Playwright |

Correr `e2e-canales` después de `e2e-ventana-social` sobre la misma base
destapó un fallo de la 023: con dos canales guardados con **llaves distintas
de la misma cuenta de Zernio** (se rota la llave y solo se reconecta uno), al
dar de alta el webhook la segunda llave lo dejaba solo con «sus» cuentas y el
otro canal dejaba de recibir en silencio. Ahora cada llave deja el webhook con
todas las cuentas de la organización que esa llave ve (`webhookAccountIds`,
con sus pruebas). Va en este mismo PR.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.2`)

Tag `v1.6.0-rc.2` sobre el commit `980b47d` de la rama; la instancia lo corre
desde el 2026-10-14 01:16 UTC (`/api/health` lo confirma por commit).

- Estado de los canales: los tres conectados y sanos; Messenger ya enseña el
  nombre de la página.
- La bandeja trae la ventana humana en sus dos conversaciones sociales reales
  (abiertas, a 2.3 h del último mensaje) y `null` en WhatsApp.
- WhatsApp: un mensaje real de la línea cliente entró y el agente contestó
  (`delivered`). La respuesta no traía negritas, así que «WhatsApp conserva su
  formato» queda demostrado solo por el guion.

**Pendiente de verificación humana**, porque hace falta que una persona
escriba desde su cuenta: que una respuesta del agente con negritas llegue sin
asteriscos a Instagram y a Messenger, y ver en la bandeja de la instancia el
aviso de ventana humana pasadas 24 horas. No se usaron las dos conversaciones
sociales que ya existen: no se le escribe a quien no lo pidió.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | La misma de la 023; etiqueta de imagen `1.6.0-rc.2` |
| Guiones de esta prueba | `ops/vivo-024.mjs` (`ventanas`, `whatsapp`), fuera del repo |
| Local | Bases `vocero_023_canales` y `vocero_024_limpia` en el Postgres propio (5433); `.env.e2e-canales` y `.env.e2e-limpia` en el clon, ignorados por git |

Los guiones E2E inician sesión una vez cada uno y el CRM limita a 10 inicios
cada 10 minutos por IP: correr más de ocho seguidos contra el mismo proceso da
429 en el siguiente. Se reinicia la app entre tandas.

### Qué sigue

026, eliminar conversación (ciclo completo: evento `conversation.deleted` en
el contrato del despacho).

## 2026-10-13 — 026: eliminar una conversación

PR #117. Ciclo completo: spec, plan y tareas antes del código, y enmienda del
contrato del despacho (`specs/021-despacho-estandar/contracts/despacho.md`:
evento `conversation.deleted` y la regla del `conversation.id` nuevo). **Sin
migración**: en el raíz las foráneas ya caen en cascada o quedan en NULL donde
hace falta; el módulo solo añade lo que una cascada no hace (adjuntos, ficha y
la cita por venir).

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,104 unitarias |
| Prueba gemela del contrato (`tests/unit/olvido-contrato.test.ts`) | El cuerpo y la firma coinciden byte a byte con `nea-agent/tests/test_olvido.py` |
| `scripts/e2e-eliminar.mjs` (nuevo) | 56/56 con cerebro y `AGENDA=on`; 40/40 sin despacho con agenda; 31/31 sin agenda |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-ventana-social` · `e2e-canales` · `e2e-messenger` · `e2e-tiktok` | 53/53 · 73/73 · 42/42 · 52/52 |
| `e2e-selftest` | 213/213 |
| Bandeja en local | La entrada al fondo de Detalles y el diálogo, con y sin la casilla, en claro y oscuro; Escape cancela; un miembro del equipo no ve la opción |

Dos cosas del arnés, no del producto:

- `e2e-tiktok` leía la conversación antes de que la ingesta sellara
  `lastInboundAt` y en un servidor frío fallaba el check de las 30 horas. Ahora
  espera, igual que `e2e-ventana-social`.
- El selftest con `AGENDA=on` dio 5 fallos de Zoom en una corrida: el entorno
  de esa corrida no apuntaba al simulador de Zoom y la app le habló al Zoom
  real. Con su entorno de siempre da 213/213.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.3`)

Tag `v1.6.0-rc.3` sobre el commit `771bfde`; la instancia lo corre desde el
2026-10-14 01:49 UTC.

**No se borró nada de nadie.** `ops/vivo-026.mjs` crea dos conversaciones
sintéticas de Instagram —remitentes que no existen, con el mensaje fechado
hace 8 días para que el agente no pudiera enviar nada— entregando eventos
firmados con el secreto que Zernio tiene para la instancia, y las elimina:

- A, alcance `hilo`: 200, sale de la bandeja, sus mensajes ya no existen, el
  contacto se queda con su etapa, borrarla otra vez da 404. Al «volver a
  escribir» es otra conversación del mismo contacto, que se limpia con
  `?contacto=1`.
- B, alcance `contacto`: 200, conversación y contacto dejan de existir.
- `agente: "no_aplica"`: la instancia no tiene despacho.
- Al terminar, la bandeja tiene las mismas 4 conversaciones que antes y ningún
  rastro de la prueba. El agente no le escribió a nadie.

**No se probó en vivo** el aviso a un cerebro de verdad: la instancia usa el
agente incluido, y Nea 1.x frente al raíz no recibe despachos (eso llega con
nea-agent#37, en la 2.0). Lo cubren el guion (un cerebro de prueba que verifica
la firma) y la prueba gemela. Nea 1.1 sí olvida por la otra vía del contrato:
al ver un `conversation.id` nuevo para la misma persona empieza de cero
(`_olvidar_si_es_otra` en su `turn.py`). **Pendiente de verificación humana:**
abrir el diálogo en la bandeja de la instancia.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Instancia | La misma; etiqueta de imagen `1.6.0-rc.3` |
| Guion de esta prueba | `ops/vivo-026.mjs`, fuera del repo |
| Local | Base `vocero_026_eliminar` en el Postgres propio (5433); `.env.e2e-eliminar` (cerebro y agenda) y `.env.e2e-eliminar-incluido` en el clon, ignorados por git |

### Qué sigue

027, importar contactos desde un CSV.

## 2026-10-14 — 027: importar contactos y contactos «sin agente»

PR #119. Carril ligero con el modelo de datos dentro (precedente de la 020):
migración aditiva `0019_contact_ai_paused`. Puerto de Vocero Cloud #108, con
una decisión propia del raíz (D4b): el nombre del archivo queda como escrito
a mano, para que el nombre de perfil de WhatsApp no lo pise.

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,116 unitarias (12 del lector de CSV, traídas de cloud) |
| `scripts/e2e-importar.mjs` (nuevo) | 37/37: 50 renglones entran y no duplican; rechazados con su motivo; el importado que escribe cae en su ficha con la IA en pausa y el agente calla; a un desconocido sí le contesta; reencender desde el contacto |
| `e2e-despacho` | 94/94 con cerebro, 14/14 con el agente incluido |
| `e2e-eliminar` · `e2e-ventana-social` · `e2e-canales` · `e2e-selftest` | 56/56 y 31/31 · 53/53 · 73/73 · 213/213 |
| Diálogo en local | Un CSV como lo exporta Excel en español (BOM, punto y coma, «Teléfono» con acento, apellidos aparte, un nombre con coma entre comillas), en claro y oscuro |

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.4`)

Tag `v1.6.0-rc.4` sobre `92670ff`; la instancia lo corre desde el 2026-10-14
03:39 UTC. `ops/vivo-027.mjs`, sin escribirle a nadie:

- Importa dos contactos con teléfonos que no pueden existir (lada 00) y un
  renglón sin lada: 2 nuevos «sin agente», 1 rechazado con su motivo, ninguna
  conversación. Repetido: 0 nuevos, 2 que ya existían.
- Uno «escribe» con un webhook sintético de WhatsApp (la instancia no tiene
  App Secret; la puerta es el segmento de la URL): su conversación nace con la
  IA en pausa, en su misma ficha y con el nombre del archivo, y en 20 segundos
  el agente no contesta una pregunta que sí contesta a cualquiera.
- Los dos se eliminan con la 026; la bandeja queda con las mismas 4
  conversaciones.

### Lo demás de esta jornada

- **Webhooks de Zernio:** a pedido de Kevin se borraron los tres inactivos
  (`vocero-ensayo16…`, `vocero-16-clase`, `vocero`) y el activo
  `megaparty-crm`, que era de sus pruebas para ese cliente en su propia cuenta
  de Zernio y recibía los eventos de sus cuentas personales. Queda solo el de
  `vocero-clase`, limitado a sus dos cuentas. Guiones `ops/zernio-limpiar.mjs`
  y `ops/zernio-borrar-uno.mjs`.
- **DMs reales de Kevin** (03:12 UTC) a Instagram y a la página: entraron con
  la imagen `rc.3`, firma verificada y webhook sin fallos. El agente no les
  contestó: «Hola prueba 1» también se queda sin respuesta por WhatsApp. Es el
  modelo eligiendo la acción `none`, que el prompt le ofrece sin decir cuándo
  usarla; ya pasaba con la 1.5.1 (el «Hola» de las 22:45 en la clase). **Queda
  pendiente** un DM con una pregunta para ver la respuesta sin asteriscos, y
  un arreglo del prompt.

### Qué sigue

Que el agente no se quede callado ante un saludo; después la 028 (pulido
visual).

## 2026-10-14 — 029: el agente no se queda callado ante un saludo

PR #120. Carril ligero: solo el prompt del agente incluido y una línea del
turno. Hallazgo de la prueba en vivo de la 027.

### Qué se probó

| Qué | Resultado |
|---|---|
| Reproducción fuera de la app (`ops/repro-saludo.mjs`: prompt, perfil, conocimiento y modelo `gpt-4o-mini` de `vocero-clase`, 8 vueltas, reintentos como `chatJson`) | Prompt de `main`: 22 mensajes sin respuesta («Hola prueba 1» 8/8, «prueba» 6/8) y reintento en todo turno con historial. Prompt nuevo: 0 y 0 |
| `pnpm eval:silencios` (nuevo; negocio de ejemplo, 6 vueltas) | 0 de 42 sin respuesta y 0 reintentos con `openai/gpt-4o-mini` y con `anthropic/claude-sonnet-4.5`; los cierres siguen en silencio |
| Gates (typecheck, lint, unitarias, build) | Verde; 1,124 unitarias (8 nuevas) |
| `e2e-selftest` · `e2e-importar` · `e2e-despacho` (agente incluido) · `e2e-ventana-social` | 213/213 · 37/37 · 14/14 · 53/53 |

La medición gasta centavos de OpenRouter con la llave de la bóveda
(`LLM_API_KEY`), que `ops/eval-silencios.mjs` pasa por entorno, nunca por argv.

### En vivo (instancia `vocero-clase`, imagen `1.6.0-rc.5`)

Tag `v1.6.0-rc.5` sobre `03e8431`; deploy `to2cjrg4b08d1u2q06ddjqbf` de la app
`3jinuviignszpotzzmvs6nrf`, `/api/health` con ese commit. Un solo «Hola prueba
2» desde la línea cliente (Evolution) al número Soporte: el agente contestó en
12 s. Con `rc.4`, «Hola prueba 1» se había quedado sin respuesta.

**Cierra la 024:** los DMs de Kevin con «¿qué servicios ofrecen y cuánto
cuestan?» a Instagram y a la página (03:49 UTC, `rc.4`) recibieron respuesta
del agente en unos 14 s, sin asteriscos.

### Qué sigue

La 028 (pulido visual), ya en la entrada siguiente.

## 2026-10-14 — 028: pulido visual de la bandeja multicanal

PR #121. Carril ligero: interfaz y un campo en el DTO de la bandeja. Dos de los
tres puntos del plan ya existían (filtro por canal desde la 014, distintivo de
TikTok desde la 022); la spec 214 de cloud que el plan citaba no está en el
clon. Kevin no mandó lista propia: si la manda, va en una spec aparte (D4).

### Qué se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verde; 1,132 unitarias (`pulido-028.test.ts`; contraste de temas en verde) |
| `e2e-selftest` · `e2e-ventana-social` (4 checks nuevos del compositor por canal) · `e2e-responsive` | 213/213 · 57/57 · verde |
| Capturas con Playwright, claro y oscuro | Compositor en WhatsApp y en Instagram (borrador y panel abiertos no pasan de una conversación a otra); bandeja vacía con cuatro canales; filtro de Instagram sin conversaciones. Consola limpia |

El «1 Issue» del overlay de Next en oscuro (visto ya en la 027) era del guion
de capturas, que fijaba el tema en el `<html>` antes de hidratar; con la
cookie del tema, como la app, no aparece.

### En vivo (instancia `vocero-clase`)

- `v1.6.0-rc.6` sobre `30288cb` (deploy `oenqkhduvc1bjt6jorb27gnz`) y
  `v1.6.0-rc.7` sobre `c0b97da` (deploy `f3jt8mfkg6rdnirdxmolidq8`), app
  `3jinuviignszpotzzmvs6nrf`.
- `ops/vivo-028.mjs` (solo lee, con la sesión del dueño): el DTO y la pantalla
  de WhatsApp traen clip, ubicación y contacto, y la de Instagram la caja sola;
  menú «CRM · Multicanal» y pestaña «CRM multicanal», en los dos temas.
- La captura en vivo enseñó un defecto que el entorno local no tenía: los
  avatares de nombres con emoji («Kevin Belier 🐏» → «K�»). Arreglado en
  `rc.7` (D7) y comprobado en la misma instancia.

### Qué sigue

PR #103 (registro de llamadas al proveedor de IA), tag `v1.6.0` y starter
2.2.0.

## 2026-10-14 — 030: el secreto de firma de Zernio, cifrado en reposo

PR #122, rama `feat/030-secreto-zernio-cifrado`. Ciclo completo: spec, plan y
tareas antes del código (`fef4d36`); implementación en `1ebda1d`. Cierra el
pendiente anotado en la 023: `webhook_secret` iba en claro desde la 014.

### Qué quedó

- Migración aditiva `0020_secreto_zernio_cifrado`: `webhook_secret_cipher`,
  `_iv` y `_tag`, nulas, en `instagram_credentials`, `messenger_credentials`
  y `tiktok_credentials`. Mismo AES-256-GCM y misma `ENCRYPTION_KEY` que el
  token.
- Una sola puerta de escritura (`columnasDelSecreto`) y una de lectura
  (`secretoDeLaFila`, con la columna vieja de respaldo) en
  `src/server/zernio/secreto-guardado.ts`.
- **La migración de datos corre al arrancar la app** (`instrumentation-node.ts`),
  no en `migrate.mjs` ni en SQL: necesita la clave validada y el mismo
  `encryptSecret`, y así corre también en `next dev`. Re-ejecutable, no pisa
  un secreto guardado a la vez y nunca tumba el arranque (spec, D3–D5).
- `webhook_secret` queda obsoleta y nula. Se quita en una versión mayor que
  pida pasar antes por la 1.6 (D6).

### Cómo se probó

| Qué | Resultado |
|---|---|
| Gates (typecheck, lint, unitarias, build) | Verdes con banderas apagadas y con `CHANNELS` + `AGENDA`; 1,145 unitarias (13 nuevas) |
| `e2e-canales` (base nueva) | 76/76: tres checks nuevos leen la base y ninguna fila trae el secreto |
| `e2e-messenger` · `e2e-tiktok` | 42/42 · 52/52 |
| `e2e-despacho` con cerebro · con el agente incluido | 94/94 · 14/14 |
| Actualización | Base nueva en `0019` sembrada con el código de `main` (3 secretos en claro, de 48 caracteres). Con la rama: `0020`, arranque con `[boot] 3 secreto(s) de firma de Zernio cifrado(s) en reposo`, columna vieja nula, la fila no contiene el secreto, firma con el secreto de antes → 200 y con uno ajeno → 401 en los tres canales; segundo arranque sin log; `e2e-canales` 76/76 sobre esa base |
| Bases de esta corrida | Ninguna con `webhook_secret` no nulo |

### En vivo

Hecha el 2026-10-15, con la autorización de Kevin para el merge. Tag
`v1.6.0-rc.8` sobre `f3a7923`; deploy `phpn47lwpicurcgb4rmgshq7` de la app
`3jinuviignszpotzzmvs6nrf`; `/api/health` con ese commit.

- Log del arranque: `[boot] 2 secreto(s) de firma de Zernio cifrado(s) en
  reposo` (Instagram y Messenger, los dos canales por Zernio de la instancia).
- `ops/vivo-023.mjs firma`: entrega firmada con el secreto que Zernio tiene
  para el webhook → 200; firma rota → 401; sin firma → 401.
- Evento de prueba de Zernio (`POST /webhooks/test`) → `success=true`, 0
  fallos; las dos cuentas y el webhook siguen activos en Ajustes → Canales.
- El último DM real de Kevin (2026-10-14, `rc.4`) fue antes de cifrar; la
  entrega firmada y el evento de Zernio recorren el mismo camino de
  verificación con el secreto ya cifrado.

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Secreto de firma de Zernio | Cifrado en `webhook_secret_{cipher,iv,tag}` de cada canal y en el webhook de Zernio. Nunca en una respuesta ni en el log |
| Local | Bases `vocero_030_actualiza`, `vocero_030_canales`, `vocero_030_cerebro`, `vocero_030_incluido` en el Postgres propio (5433); `.env.e2e-030-*` en el clon, ignorados por git |
| Guion de la actualización | `actualiza-030.mjs` en el scratchpad de la sesión, fuera del repo; guarda los secretos de prueba (del simulador) en un archivo, nunca en pantalla |

### Qué sigue

Tag `v1.6.0` y starter 2.2.0.

## 2026-10-14 — Publicación de 1.6.0 y starter 2.3.0

Autorizado por Kevin en el chat («el tag sí publícalo y actualiza el
starter»), después de probar él mismo la guía de 18 puntos en `vocero-clase`
con la imagen `rc.7`: todo bien.

- **PR #103 cerrado sin mergear** por decisión de Kevin: el registro de
  llamadas al proveedor rompe el minimalismo; lo que pedía el #85 ya lo cubren
  el estado de la llave en Ajustes → IA y el aviso de arriba.
- **PR #123** (`release/1.6.0`): versión `1.6.0`, CHANGELOG con «Actualizar
  desde 1.5.1», imagen `1.6.0` en README, INSTALL-IA, docker-compose y los
  manifiestos de Render, Fly y Railway (la prueba `manifests-plataformas` lo
  exige). Gates verdes, CI verde.
- **Tag `v1.6.0`** sobre `da32409` → imagen `ghcr.io/kevinrivm/vocero-crm:1.6.0`;
  `latest` apunta al mismo digest. Release de GitHub «Vocero CRM 1.6.0 —
  multicanal» con las notas del CHANGELOG.
- **`vocero-clase`** pasa a la estable: deploy `cet0mi9crrphwrwknqofgfun` de
  la app `3jinuviignszpotzzmvs6nrf`; `/api/health` → `1.6.0` · `da32409`;
  firma de Zernio 200/401/401 y el evento de prueba de Zernio sin fallos.
- **Starter 2.3.0** (copia maestra en `Vocero-cloud astra/vocero-starter-v2`,
  sin remoto; tag `v2.3.0`, zip `vocero-starter-v2.3.0.zip` sin `.env`): fija
  Vocero 1.6.0 + Nea 1.1.0 y pone al día los textos de límites de la 1.5.
  Se revisó que su `canales.mjs webhook` no duplique el webhook que el CRM
  1.6 da de alta al guardar cada canal: los dos usan el nombre
  `vocero-<dominio>` y el guion actualiza el que encuentra. `plan` y
  `estado` del guion nuevo, contra `vocero-clase`, en verde. TikTok no entra
  al starter todavía (falta su prueba real); queda cómo encenderlo a mano.
- El `.env` del starter de la clase (`Downloads/vocero-starter-v2`) pasa a
  `VOCERO_CRM_VERSION="1.6.0"`, la que corre la instancia.

### Pendiente

- TikTok (022) con un mensaje real cuando TikTok apruebe la cuenta Business.
- PR #118 («Merge with vocero crm», rama `develop`): no es de esta sesión;
  sin tocar hasta que Kevin diga qué es.

### Qué sigue

La 2.0.0 del plan: Nea recibe el despacho también contra el raíz (nea #37).

## 2026-10-15 — `vocero-clase` como consultorio médico (demo, sin código)

Para el video de multicanalidad, `vocero-clase` pasa a ser el demo de un
consultorio («Consultorio San Rafael», agente Sofía). Solo datos y una
bandera: ningún cambio al CRM, ningún PR.

- **Bandera:** `AGENDA=on` en la app `3jinuviignszpotzzmvs6nrf` (variable
  `f3eqwfgou0o0aca9rk2chog3`, solo runtime) + deploy
  `qlsz3nfiagogon7gf9x4zqab`. Sigue en `1.6.0` · `da32409`.
- **Siembra:** `ops/consultorio.mjs` con `ops/negocios/consultorio.json`
  (mismo patrón que `vocero-demos/ops/vocero.mjs`): marca e ícono, agente y
  7 entradas de conocimiento, etapas (Nuevo paciente → Cita agendada →
  Seguimiento pendiente → Paciente atendido / No continuó), agenda L–V 9–14 y
  16–19, sáb 9–13, 30 min, presencial (enlace fijo sin sala). Historia: 12
  pacientes ficticios (+1 NXX 555-01xx) y 9 citas entre el 16 y el 21 de oct.
- **Respaldo previo** (marca «Vocero», ícono, perfil del agente, 9 entradas
  de KB, 5 etapas) en `ops/respaldos/clase-2026-10-15T17-45-59.json`; se
  regresa con `node ops/consultorio.mjs restaurar <archivo>`.
- **En vivo (WhatsApp, línea cliente por Evolution, 4 mensajes):** el número
  Soporte ya apuntaba a `vocero-clase` por el override de la WABA (no se movió
  nada). Sofía pidió nombre y motivo, ofreció huecos reales y reservó el
  viernes 16 a las 9:00 (`source: ai`, verificada en `/api/bookings`); la cita
  de prueba se canceló desde la API (cancelar no avisa al paciente).
- **Hallazgo:** `offer_slots` del agente incluido no acepta preferencia de día:
  a «mañana en la mañana» enseña los primeros huecos (hoy en la tarde). Si el
  paciente nombra fecha y hora que estén entre los 12 ofrecidos, sí reserva.
  Mitigado en las instrucciones del agente; el arreglo de fondo es una spec.

## 2026-10-19 — 031: Nea entra solo por el despacho (2.0, nea#37)

PRs: [#125](https://github.com/kevinrivm/vocero-crm/pull/125) (CRM) y
[nea-agent#43](https://github.com/kevinrivm/nea-agent/pull/43), ramas
`feat/031-nea-por-despacho` en los dos repos. Ciclo completo: spec, plan y
tareas antes del código (`73c4450`). **Abiertos, sin mergear.**

Antes de empezar, Kevin aprobó en el chat seguir con la 2.0 y las dos
recomendaciones abiertas: el cerebro piensa por el CRM (#106, `/api/bot/llm`)
y una sola base para el par (`DATABASE_SCHEMA`, ya en esta spec).

### Qué quedó

- **CRM** (aditivo): `adOrigen` en `/api/bot/context`; `fileName`, `location`
  y `contacts` en el mensaje del despacho, solo cuando aplican (el cuerpo
  gemelo no cambia); el simulador de WhatsApp acepta tarjetas; contrato 021
  enmendado.
- **Nea 2.0** (mayor): `/vocero/dispatch` es la única entrada también contra
  la raíz (firma con `CRM_BOT_API_KEY`); el prompt nombra el canal (en
  WhatsApp el chasis queda idéntico byte a byte); dedup por mensaje en los dos
  modos; `DATABASE_SCHEMA`; fuera webhook, relay, coalesce, los reintentos del
  turno (D2b, decidida al implementar) y siete variables; `POST /webhook` →
  503 y `webhookDeMeta` en `/health`.

### Cómo se probó

| Qué | Resultado |
|---|---|
| CRM: `typecheck`, `lint`, `test`, `build` | Verdes; 1,149 unitarias |
| CRM: `e2e-despacho.mjs` con cerebro | 101/101 (sección 031: 7/7) |
| Nea: `pytest` | 475 verdes, 30 saltadas. 1 roja que ya fallaba en `main` y solo en Windows local (`pypdf` en el site de usuario; el subproceso del PDF corre con `-I`) |
| Nea: `test_pg_store.py` contra Postgres 16 | 30/30, incluido el esquema propio |
| Nea: `live-security-test.py` | PASS |
| `e2e_contra_raiz.py` (Meta → CRM → despacho → Nea, una sola base, `z-ai/glm-5.3-flash`) | 9/9; mediana 8.2 s por turno; US$0.006 |

### En vivo, local

CRM de la rama (`next dev`, :3290) + Nea de la rama (:8290) sobre la base
`vocero_031_vivo` (Nea en el esquema `nea`), número «Soporte» (…9518) y línea
cliente (…9768) por Evolution. `ALLOWED_WA_IDS` de Nea con la línea cliente.

| | UTC |
|---|---|
| Override del número movido al relevo (`ops/relay.mjs` → túnel) | 04:20:54 |
| Override devuelto: **quitado** (el número no tenía; el tráfico vuelve a la WABA, `vocero-clase`) | 04:29:31 |

- Mensaje 1 (04:21): el despacho llegó a Nea, que pidió el contexto por
  `conversationId` y mandó «escribiendo…»; el modelo dio 401 y la conversación
  pasó a humano con motivo `error`, como debe. Causa: una variable de usuario
  de Windows, `OPENAI_API_KEY`, que pydantic lee antes que el `.env` de Nea. No
  es del producto (en el contenedor no existe); Nea se relanzó sin heredarla
  (`lanzar.py` en el scratchpad).
- Mensaje 2 (04:26): con Nea apagada. El CRM lo guardó y lo pasó a humano: el
  escenario 7 del e2e, en vivo.
- Mensaje 4 (04:29, el 3 quedó detrás del traspaso hasta reactivar la IA con
  `reactivate: true`): **Nea contestó en 20.7 s**, `delivered`, origen `ai`,
  y en una sola respuesta atendió lo que había quedado pendiente (qué venden,
  horario, taladros).
- Por el relevo solo pasó tráfico de la línea cliente: 4 mensajes y 1
  respuesta. Gasto de OpenRouter: centavos.

El DM real de Instagram se hizo después, en Coolify (abajo).

### En vivo, Coolify (2026-10-20)

Kevin autorizó en el chat montar el par en `vocero-16` desde las ramas. Tags de
prelanzamiento `v2.0.0-rc.1` en los dos repos (sobre `1770a7a` y `f57eeba`):
publicaron `ghcr.io/kevinrivm/vocero-crm:2.0.0-rc.1` y
`ghcr.io/kevinrivm/nea-agent:2.0.0-rc.1` sin mover `latest`.

- Servicio `vocero20-par` (`dlh4zhtqg8avc2qlxfb8eodz`): CRM
  (`dbatl4la70eknhflxs1sfk8i`), Nea (`cgzk4ndoeg1yd1doarbzlpmq`) y Postgres
  (`iclpugyjs0qecbetmh3bqx4v`) en un compose. **Una sola base**: Nea creó su
  esquema `nea` y migró ahí. El CRM despacha a `http://nea:8000` por la red
  del servicio. URL `https://vocero20.177.7.62.92.sslip.io`; healthcheck de
  Coolify apagado en el compose. `/api/health` → `1770a7a`, verificado.
- Claves generadas por Coolify (`SERVICE_PASSWORD_*`,
  `SERVICE_REALBASE64_32_CIFRADO`); `BOT_API_KEY` y `CRM_BOT_API_KEY` son la
  misma variable mágica. `ALLOWED_WA_IDS` va vacía: en WhatsApp el relevo ya
  filtra a la línea cliente.
- **La llave de OpenRouter de Nea** (`LLM_API_KEY`) se guardó con
  `ops/coolify-env.mjs`, por la API REST de Coolify: **excepción a la regla 5
  autorizada por Kevin el 2026-10-20, solo para esa variable**, porque por el
  MCP el valor habría quedado escrito en la conversación. Lista cerrada
  (servicio y variable); el valor no se imprimió (…09bd).

| | UTC |
|---|---|
| Override del número movido al relevo → túnel → `vocero20` | 12:22:17 |
| Mensaje de la línea cliente | 12:22:23 |
| Respuesta de Nea, `delivered`, origen `ai` | 14.1 s después |
| Override devuelto (quitado: el tráfico vuelve a la WABA, `vocero-clase`) | 12:22:40 |

Un mensaje y una respuesta; por el relevo solo pasó la línea cliente.
`brain-status` del CRM: despacho activo hacia `nea:8000`, sin fallas.

| Qué | Dónde |
|---|---|
| Dueño de la instancia | `.env.vocero20` del espacio de trabajo (correo `OWNER_EMAIL`, contraseña generada) |
| Llave de IA de Nea | Variable `LLM_API_KEY` del servicio; sale de `LLM_API_KEY` de la bóveda |
| Token de WhatsApp | Cifrado en la base del CRM; sale de `WA_TOKEN` de la bóveda |

### Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| Entornos de la prueba local | `vocero-crm/.env.vivo031` (ignorado por git) y `nea-vivo/.env` del scratchpad de la sesión. Los arma `ops/vivo-031.mjs entornos` desde la bóveda; ningún valor pasó por el chat |
| Guiones nuevos | `ops/vivo-031.mjs` (`entornos`, `conversacion`, `reactivar`). `override.mjs` guarda ahora el override de la WABA como respaldo y `relay.mjs` le manda ahí lo ajeno cuando el número no tenía override |
| Estado viejo del override | `.override-soporte.2026-10-13.json` (archivado; decía «sin devolver» desde la clase, pero ese día se quitó por decisión de Kevin) |
| Bases locales | `vocero_031_cerebro`, `vocero_031_incluido`, `vocero_031_par`, `vocero_031_vivo` en `vocero-20-pg` (5433) |

### Qué sigue

#### Instagram, con DMs reales de Kevin

- `ops/canales.mjs conectar` en `vocero20`: Instagram **@kevinbelier.ia** y la
  página «Kevin Belier» por Zernio. El CRM dio de alta su webhook
  (`vocero-vocero20.177.7.62.92.sslip.io`), limitado a las 2 cuentas de Kevin.
- `vocero-clase` recibe los mismos DMs (su webhook, también limitado a esas
  2 cuentas). Para que su agente no contestara encima, se **apagó de 16:22:42
  a 16:30:36 UTC** y se volvió a encender (`answering: true`).
- `ALLOWED_WA_IDS` de Nea: primero `ig:nadie-todavia` (nadie pasa); el primer
  DM de Kevin (16:27:25) entró a la bandeja y Nea lo frenó en el log
  (`allowlist: ig:…5620`); con esa identidad en la lista y un redeploy, el
  segundo DM (16:30:03, una pregunta) **recibió respuesta de Nea a las
  16:30:24**, `sent`, origen `ai`, sin asteriscos ni formato de WhatsApp.
- Al terminar: webhook de Zernio de `vocero20` **desactivado** (16:30:45), no
  borrado; el de `vocero-clase`, activo como estaba.

**Hallazgo (ya estaba en `main`, no es de la 031):** el seguimiento de 4 h
(`app/followup.py`) y el reintento de envíos (`app/sender.py`) no miran
`ALLOWED_WA_IDS`. A las 16:23:42 Nea le mandó el empujón de seguimiento a la
línea cliente de Kevin (la conversación de WhatsApp de las 12:22) aunque la
lista ya no la incluía. Fue a la propia línea de Kevin; queda para un arreglo
aparte.

Con esto la 031 queda probada en vivo en WhatsApp e Instagram, en local y en
Coolify. Messenger y TikTok, solo con simuladores.

### Qué sigue

Que Kevin revise y mergee #125 y nea-agent#43; el arreglo del seguimiento y
la lista de permitidos; luego #91 (Laboratorio por contrato).

## 2026-10-20 — 033: Laboratorio por contrato (#91)

PRs: [#127](https://github.com/kevinrivm/vocero-crm/pull/127) (CRM) y
[nea-agent#45](https://github.com/kevinrivm/nea-agent/pull/45), ramas
`feat/033-laboratorio-por-contrato`. Ciclo completo: spec, plan y tareas
antes del código (`c5930cd`). Antes de empezar, con autorización de Kevin en
el chat («tu mergea y sigue»), se mergearon #125 y nea-agent#43 (031).

### Qué quedó

- Con el despacho activo, el Laboratorio prueba al cerebro que contesta: cada
  línea del guion entra a la conversación de prueba, se despacha sin ventana y
  la respuesta vuelve por `/api/bot/messages`, que la **guarda sin enviarla**
  (antes, 409 `sandbox_violation`). El guard de `sendText` no se tocó.
- El evento lleva `conversation.test: true` solo en las de prueba; el cuerpo
  gemelo no cambia. Nea: una prueba pasa la lista de permitidos y no programa
  seguimiento.
- Runner: 90 s por turno; olvido (`conversation.deleted`) al terminar cada
  caso; estado `agent_failed` (sin migración: texto) con el motivo en la
  corrida; `failed` si nadie contestó.
- Personas nuevas: hostil y sin rumbo (la de nota de voz espera a #93).
- **Dos decisiones tomadas por la prueba en vivo** (spec, D7b y la línea
  SISTEMA): un silencio con el despacho entregado es una respuesta (Nea calla
  ante el relleno tras despedirse; la primera corrida lo marcó como falla), y
  el traspaso se anota en la transcripción como línea SISTEMA (el juez marcaba
  «debió escalar» a un agente que sí escaló).
- El 409 `sin_agente` al iniciar pasa a la #106: hoy el agente incluido
  siempre contesta las pruebas si hay IA.

### Cómo se probó

| Qué | Resultado |
|---|---|
| CRM: `typecheck`, `lint`, `test`, `build` | Verdes; 1,153 unitarias |
| `e2e-despacho.mjs` con cerebro | 110/110: corrida en verde, `test: true`, respuestas guardadas, silencio leído como respuesta, olvidos, wa-mock vacío, cerebro caído → `failed` con motivo |
| `e2e-despacho.mjs` con el agente incluido | 17/17, con una corrida del Laboratorio |
| Nea: `pytest` | 478 verdes (la del PDF, solo en Windows) |

### En vivo (`vocero20`, Coolify)

Imágenes de prelanzamiento `2.0.0-rc.2` (CRM y Nea), `rc.3` y `rc.4` (solo
CRM, con las dos correcciones). Kevin no mandó nada: el Laboratorio no le
escribe a nadie. El proveedor de IA del juez se guardó por la API del CRM
(`ops/vivo.mjs ia`), cifrado.

| Corrida | Imagen | Resultado |
|---|---|---|
| `run_c7z1bo57fy21vjw6jjnr` | rc.2 | 7 `done` + «Sin rumbo» `agent_failed` (era el silencio del candado) · 199 s |
| `run_tham0i3131ch8ib2uisl` | rc.3 | 8 `done` · score 44 · 194 s · «Pide un humano» rojo: el juez no veía el traspaso |
| `run_hiqiycyd4uq37sbfzvs4` | rc.4 | **8 `done` · score 56 · 194 s · «Pide un humano» verde** · despacho sin fallas |

Observación de calidad, no de la spec: con `openai/gpt-4o-mini`, el juez marca
rojo «Hostil» (Nea escaló al tercer insulto; el juez lo quería antes) y «Fuera
del conocimiento» (Nea no inventó y escaló; el juez señala el hueco para
sugerir una entrada de conocimiento, que es lo que debe hacer).

Guion: `ops/vivo-033.mjs <base> <env>` (corrida + resumen, sin contenido de
nadie real).

### Qué sigue

Que Kevin revise y mergee #127 y nea-agent#45; luego #90 (roles como datos).

## 2026-10-20 — 034: roles como datos (#90)

PRs: [#128](https://github.com/kevinrivm/vocero-crm/pull/128) (CRM) y
[nea-agent#46](https://github.com/kevinrivm/nea-agent/pull/46), ramas
`feat/034-roles-como-datos`. Ciclo completo: spec, plan y tareas antes del
código (`337c37a`). Antes de empezar, con autorización de Kevin en el chat,
se mergearon #127 y nea-agent#45 (033) y se cerró #91.

### Qué quedó

- `agent_profile.role` (`calificador`) y `agent_profile.tools` (jsonb; `null`
  = todas), migración aditiva `0021_roles_como_datos`.
- Catálogo con claves estables (`ficha`, `agendar`, `reprogramar`, `salida`,
  `escalar`; `escalar` no se apaga) y el rol Calificador como bloque
  (instrucciones, reglas de escalado, herramientas y las 8 personas) en
  `src/lib/agent-roles.ts`.
- `GET /api/bot/profile` gana `role` y `tools`; `PUT /api/agent/profile`
  acepta `tools`; `POST /api/agent/profile/preset` carga el rol.
- Pantalla Agente: tarjeta del rol con un interruptor por herramienta (las de
  agenda solo con `AGENDA=on`) y el preset con confirmación. Guardar el
  comportamiento ya no pisa las herramientas.
- El Laboratorio corre las personas del rol.
- Nea: le enseña al modelo solo las encendidas; sin `agendar`, se porta como
  contra un CRM sin agenda; sin `tools`, todas.

### Cómo se probó

| Qué | Resultado |
|---|---|
| CRM: `typecheck`, `lint`, `test`, `build` | Verdes; 1,161 unitarias |
| `e2e-roles.mjs` | 15/15 |
| Migración | Base vacía; base en `0020` con un perfil (queda Calificador con todas, conserva instrucciones); re-ejecutable |
| Pantalla | Capturas en claro, oscuro y móvil (390 px) |
| Nea: `pytest` | 485 verdes (la del PDF, solo en Windows) |

### En vivo (`vocero20`, imágenes `2.0.0-rc.5`)

`AGENDA=on` y `ALLOWED_WA_IDS` borrada del servicio (en WhatsApp el relevo ya
filtra a la línea cliente; el webhook de Instagram de `vocero20` sigue
desactivado). Horario de pruebas L–S 9–19 con `ops/vivo-034.mjs agenda`.

| | UTC | Resultado |
|---|---|---|
| Override movido / devuelto (1) | 18:03:38 / 18:03:54 | «agendar» encendida: «cita mañana en la tarde» → Nea ofreció 15:00, 15:30 y 16:00 (14.3 s) |
| «agendar» y «reprogramar» apagadas desde la API de la pantalla | 18:04:02 | Sin redeploy; se esperó el TTL del perfil de Nea (5 min) |
| Override movido / devuelto (2) | 18:09:46 / 18:10:02 | «para el viernes en la mañana» → «no agendamos citas por aquí» y traspaso al equipo (12.7 s) |

Dos mensajes de la línea cliente y dos respuestas; por el relevo solo pasó
esa línea. Al terminar, `vocero20` volvió a todas las herramientas.

**Incidente:** a mitad del redeploy, el token de Coolify de la bóveda dejó de
valer (401). Kevin puso uno nuevo (…318b) en `.env`; el MCP de Coolify lo
tomó al detener su proceso local (la app lo relanzó). `vocero20` quedó en
503 hasta el siguiente deploy.

### Qué sigue

Que Kevin revise y mergee #128 y nea-agent#46; luego #92 (OpenAPI y guía de
migración).

## 2026-10-20 — 035: contrato público y guía de migración (#92)

PR #129 (rama `feat/035-contrato-y-migracion`). Kevin autorizó mergear la 034
y seguir con la #92.

### Qué quedó

- `docs/openapi.json` (OpenAPI 3.1): las diez rutas de `/api/bot/*` y, en
  `webhooks`, el despacho y el olvido con sus cuerpos gemelos. Lo sirve
  `GET /api/bot/openapi.json` (estático, sin llave).
- `openapi.test.ts` lo valida contra las rutas (en las dos direcciones), los
  409 de `/api/bot/messages`, el catálogo de herramientas y los cuerpos
  gemelos del despacho y del olvido.
- «Recuperar el webhook» en Configuración → WhatsApp. Quita el override
  ajeno de la WABA y deja el del número hacia el CRM. Solo lo puede hacer
  quien administra.
- El compose gana el servicio `nea`, detrás del perfil `nea` hasta publicar
  nea 2.0.0. Render trae el bloque comentado; Fly y Railway, la receta en
  comentarios.
- Guía `docs/migrar-a-2.0.md`; README, INSTALL-IA y CHANGELOG al día.

### Cómo se probó

| Qué | Resultado |
|---|---|
| `typecheck`, `lint`, `test`, `build` | Verdes; 1,172 unitarias; la ruta del OpenAPI sale estática |
| `e2e-recuperar-webhook.mjs` (wa-mock) | 8/8 |
| `docker compose --profile nea config` | 4 servicios; sin el perfil, los 3 de siempre |
| `manifests-plataformas` | 30/30 |

**Incidente:** el primer build de `v2.0.0-rc.6` falló, porque `.dockerignore`
excluía `docs/` y la ruta importa el OpenAPI. Se dejó entrar solo
`docs/openapi.json` (`6c69ddd`). El tag se movió a ese commit; el fallido no
había publicado ninguna imagen.

### En vivo (`vocero20`: CRM `2.0.0-rc.6`, Nea `2.0.0-rc.5`)

Compose del servicio `dlh4zhtqg8avc2qlxfb8eodz` actualizado y desplegado por
el MCP de Coolify. Para la prueba se usó `ops/vivo-035.mjs`.

El número Soporte ya estaba en el escenario de la 035: la WABA (con un solo
número) enrutaba a un override ajeno, el de `vocero-clase`, y el número no
tenía ninguno. El guion guardó ese override en `../.override-waba-soporte.json`
(fuera de todo repo), comprobó que contestara el reto y lo devolvió al
terminar.

| | UTC | Resultado |
|---|---|---|
| `GET /api/bot/openapi.json` | 18:32:38 | 200 · `openapi 3.1.0` · 11 rutas · webhooks `despacho`, `olvido` |
| «Registrar en Meta» | 18:32:46 | `skipped: waba_override`, host `vocero-clase…`; el número y la WABA quedaron como estaban |
| «Recuperar el webhook» | 18:32:49 | 200; el número apunta a `vocero20` y la WABA quedó sin override |
| Un DM de la línea cliente | 18:32:51 | Llegó a la bandeja de `vocero20` por el webhook recuperado |
| Devuelto | 18:33:55 | WABA → `vocero-clase` otra vez; número sin override (en ese orden, sin hueco) |

El DM no tuvo respuesta, y era lo correcto: la conversación seguía en traspaso
desde el cierre de la 034 (`handoffAt` 18:09:59). No se mandó un segundo DM
(regla 7); el camino de respuesta no cambia en la 035 y quedó probado en la
034. Después se reactivó la IA de esa conversación (`reactivate: true`).

Fuera de esos 66 s, Soporte no se movió de `vocero-clase`.

### Qué sigue

Que Kevin revise y mergee #129. Luego, la #106: retirar el agente incluido,
que el CRM piense por Nea (`/api/bot/llm`) y quitar el perfil `nea` del
compose.

## 2026-10-20 — 036: retiro del agente incluido (#106)

PR #130 (rama `feat/036-retiro-agente-incluido`) y nea-agent#47 (rama
`feat/036-pensar-por-el-crm`). Kevin autorizó mergear la 035 y seguir con la
#106. Las dos decisiones de producto ya estaban tomadas: el cerebro piensa por
el CRM y el par usa una sola base.

### Qué quedó

- El CRM no trae agente. Se fueron el turno dentro del proceso, el prompt del
  agente y `agenda/agent` con sus pruebas. La ingesta solo despacha.
- `POST /api/bot/llm/{ruta}`: proxy compatible con OpenAI que usa la llave de
  Ajustes → IA. `BOT_API_KEY` vale también como Bearer. Un 401 o 402 del
  proveedor pausa la llave. El perfil gana `llm {path, model}`.
- El interruptor del Agente ahora significa «el CRM despacha». Encenderlo
  exige cerebro configurado y con `/health` sano; si no, 409 `sin_cerebro`.
- El Laboratorio solo prueba por despacho. «Quién responde» avisa con
  `sin_cerebro` o `apagado`. La guía de inicio gana el paso «Conecta tu
  agente», opcional: sin él, Vocero es una bandeja manual.
- Nea, con `LLM_API_KEY` vacía, piensa por el CRM con el modelo del perfil. Su
  `/health` gana el campo `llm`.
- Compose y Coolify: Nea sin llave de IA. Se borró `LLM_API_KEY` del servicio
  `vocero20-par` (`dlh4zhtqg8avc2qlxfb8eodz`). Desde ahora no hay secreto de
  IA fuera de Ajustes → IA del CRM.

### Cómo se probó

| Qué | Resultado |
|---|---|
| CRM: `typecheck`, `lint`, `test`, `build` | Verdes; 1,137 unitarias (nuevas: proxy 11, interruptor 9) |
| Arnés E2E contra un cerebro falso compartido (`scripts/lib/cerebro-falso.mjs`) | selftest 280/280, despacho 134/134, importar 38/38, resultados 71/71, tiktok 52/52, ventana-social 58/58, eliminar 57/57, roles 15/15, recuperar-webhook 8/8 |
| Nea: `pytest` | 507 verdes (25 nuevas); la del PDF falla solo en Windows |
| Interfaz | Capturas en claro, oscuro y móvil (390 px) del estado sin cerebro |

### En vivo (`vocero20`: CRM y Nea `2.0.0-rc.7`)

Compose actualizado y desplegado por el MCP de Coolify. Nea arrancó con «LLM_API_KEY
vacía: Nea piensa por el CRM». «Quién responde» quedó así: encendido, IA
activa (OpenRouter `…09bd`, `openai/gpt-4o-mini`), sin avisos, Nea `2.0.0-rc.7`
en línea. Para la prueba se usó `ops/vivo-036.mjs`.

| | UTC | Resultado |
|---|---|---|
| Override movido / devuelto (relevo por túnel) | 22:03:06 / 22:03:23 | Un DM de la línea cliente. Nea contestó en 12.3 s (134 caracteres, `delivered`). En los logs de Nea: «pienso con openai/gpt-4o-mini» y `POST /api/bot/llm/chat/completions` → 200 |
| Laboratorio | 22:03:44 – 22:07:11 | 8/8 casos contestados por la Nea conectada y juzgados, sin fallas de entrega. Score 56: refleja el poco conocimiento cargado en `vocero20`, no el mecanismo |

Un mensaje de la línea cliente y una respuesta; por el relevo solo pasó esa
línea. Soporte quedó como estaba: el número sin override y la WABA hacia
`vocero-clase`.

**Pendiente, de antes de la 036:** el log de Nea avisa que
`LLM_TRANSCRIBE_MODEL` sigue en `whisper-1`, y por un proveedor compatible
(ahora el CRM) las notas de voz van a fallar. Hay que elegir un modelo que oiga.

**Cambio de producto a revisar:** con el agente incluido se fue la acción de
mover un lead de etapa (`move_stage`). `/api/bot/*` no tiene ruta para eso,
así que hoy ningún cerebro puede mover etapas.

### Qué sigue

Que Kevin revise y mergee #130 y nea-agent#47. Después, #93 (almacenamiento),
el tag 2.0.0 (que quita el perfil `nea` del compose) y el starter 3.0.0.

## 2026-10-20 — 037: adjuntos en disco o en un bucket S3-compatible (#93)

PR #132 (rama `feat/037-almacenamiento`). Kevin autorizó mergear la 036 y
seguir con la #93.

### Qué quedó

- `src/lib/storage/` trae dos puertos de la edición cloud: el cliente S3
  firmado con SigV4 a mano (sin SDK) y el adaptador.
- Se escribe donde diga `MEDIA_STORE` y se lee en los dos sitios. Si el bucket
  falla al escribir, o tarda más de 15 s, el archivo va al disco.
- El icono, al cambiarse, borra la copia del otro lado.
- `mediaWritable` y `pnpm doctor` prueban el bucket. `/api/health` gana
  `features.media`.
- Compose: el perfil `bucket` levanta un MinIO de `coollabsio/minio` (las
  imágenes oficiales dejaron Docker Hub) y un contenedor que crea el bucket.

### Cómo se probó

| Qué | Resultado |
|---|---|
| `typecheck`, `lint`, `test`, `build` | Verdes; 1,161 unitarias (24 de almacenamiento, firma contra el vector de botocore) |
| `e2e-almacenamiento` contra MinIO local | disco 12/12, bucket 29/29 (con el bucket caído a media fase), vuelta 11/11 |
| `e2e-selftest` en modo bucket | 280/280; siete adjuntos en MinIO y ninguno en disco |
| `pnpm doctor` | Bucket sano ✓; detenido `bucket_red`; secreto malo `bucket_403` |
| Perfil `bucket` del compose | MinIO sano y bucket creado |

### En vivo (`vocero20`: CRM `2.0.0-rc.8`, Nea `2.0.0-rc.7`)

Al servicio `vocero20-par` (`dlh4zhtqg8avc2qlxfb8eodz`) se le agregaron un
`minio` (volumen `minio-data`, sin puertos públicos) y un `minio-bucket` que
crea el bucket `vocero` y lo lista. Las llaves son variables mágicas de
Coolify (`SERVICE_USER_MINIO` y `SERVICE_PASSWORD_MINIO`): ningún secreto pasó
por el chat ni por la línea de comandos. `/api/health` dio `media: bucket` y
`mediaWritable: true`. Para la prueba se usó `ops/vivo-037.mjs`, y
`ops/evolution.mjs` ganó `enviarImagen`.

| | UTC | Resultado |
|---|---|---|
| Override movido / devuelto (relevo por túnel) | 23:56:00 / 23:56:10 | Una imagen PNG de la línea cliente. Llegó a la bandeja y `GET /api/media/ma_kk975qkxzqp37nz5xxf1` devolvió 200 `image/png` (293 bytes) |
| Listado del bucket (`minio-bucket`) | 23:56:08 | `org_r4kx1p6x854mfchoju4n/ma_kk975qkxzqp37nz5xxf1`, 293 B: la imagen está en MinIO |

Un mensaje de la línea cliente; por el relevo solo pasó esa línea. Soporte
quedó como estaba. El `minio-bucket` quedó con un `sleep 600` al final para
poder leer su listado en los logs; termina solo.

**Límite conocido:** si el icono se cambia con el bucket caído, al volver el
bucket se sirve el icono viejo hasta subirlo otra vez (llaves versionadas:
fuera de esta spec).

### Qué sigue

Que Kevin revise y mergee #132. Pendientes del mismo cierre: #131 y
nea-agent#48 (038, mover de etapa: falta su prueba en vivo), el tag 2.0.0
(que quita el perfil `nea` del compose) y el starter 3.0.0.

## 2026-10-20 — 038: el cerebro mueve la etapa

Rama `feat/038-cerebro-mueve-etapa` y nea-agent `feat/038-mover-etapa`. Sale
del «cambio de producto a revisar» de la 036: con el agente incluido se fue
`move_stage` y ningún cerebro podía mover etapas. La 037 queda para la #93.

### Qué quedó

- `POST /api/bot/stage {conversationId, stage}` (nombre o id). Solo hacia
  adelante y a etapas abiertas: ganar o perder lo decide una persona. Misma
  etapa = 200 `changed: false`, sin evento. Pasa por `moveLeadToStage` con
  `source = "bot"`.
- Errores tipados: 409 `etapa_no_permitida`, `herramienta_apagada` y
  `ai_paused`; 422 `etapa_desconocida`; 404 `sin_lead`. Los de etapa traen
  las válidas en el mensaje.
- `GET /api/bot/context` gana `lead.nextStages`: va en el contexto y no en el
  perfil porque depende de la etapa de ese momento.
- Herramienta nueva `etapa` («Mover de etapa») en el catálogo del rol. El CRM
  la hace cumplir. Encendida donde «todas» es el valor (`tools = null`, preset
  Calificador); un perfil con lista elegida a mano la recibe apagada.
- Corrige la 034 D1: la ficha nunca movía la etapa. La descripción de
  `/api/bot/ficha` en el OpenAPI decía que sí; ya no.
- Nea: herramienta `move_stage`, que solo aparece con la clave encendida y
  `nextStages` en el contexto. Contra cloud o un raíz anterior no existe.

### Cómo se probó

| Qué | Resultado |
|---|---|
| CRM: `typecheck`, `lint`, `test`, `build` | Verdes; 1,151 unitarias (nuevas: `bot-etapa` 14) |
| E2E `scripts/e2e-etapa.mjs` (cerebro falso: lee el contexto y mueve) | 31/31 |
| Regresión: `e2e-despacho` (cerebro falso tocado) y `e2e-roles` (catálogo nuevo) | despacho 134/134, roles 15/15 (en una base limpia: el registro se cierra tras la primera organización) |
| Nea: `pytest` | 515 verdes (7 nuevas); la del PDF falla solo en Windows, igual que en `main` |

### En vivo

Pendiente de verificación humana: otra sesión usa el número Soporte y
`vocero20`. Hay que coordinar la prueba (un DM que califique y ver la tarjeta
moverse en el Pipeline).

### En vivo (`vocero20`: CRM y Nea `2.0.0-rc.9`), 2026-10-21

Antes de la prueba, la rama se puso al día con `main` (que ya traía la 037):
el único choque fue la bitácora. Con `ops/vivo-038.mjs preparar` se encendió
`etapa` en `vocero20`. Su lista de herramientas venía elegida a mano y por eso
la recibió apagada, como dice D3. El lead de la línea cliente estaba en
«Nuevo», con «En conversación» e «Interesado» como siguientes abiertas.

| | UTC | Resultado |
|---|---|---|
| Override movido / devuelto (1) | 00:36:25 / 00:38:00 | «Me interesa contratarlos, ¿cómo le hacemos para empezar?» → Nea contestó en 12.1 s con una sola llamada al modelo y ninguna herramienta. El lead siguió en «Nuevo» |
| Override movido / devuelto (2) | 00:38:44 / 00:40:18 | «Lo quiero para mi consultorio dental y me gustaría empezar la próxima semana» → Nea guardó la ficha (`PUT /api/bot/ficha`) y contestó en 12.7 s, pero no llamó `move_stage`. El lead siguió en «Nuevo» |

Dos mensajes de la línea cliente; Soporte quedó como estaba.

**Resultado: no pasa.** La mecánica responde como debe: el contexto trae
`nextStages`, Nea arma `move_stage` con la herramienta encendida, el prompt
la menciona y el e2e con el cerebro falso lo cubre. Lo que falla es que el
modelo (`openai/gpt-4o-mini`) no la usa con la instrucción actual («cuando la
conversación lo amerite»). No se mergeó: la decisión de cómo instruirlo es de
Kevin.

**Repetición con `z-ai/glm-5.3-flash`** (2026-10-21). El modelo anterior era
el `LLM_MODEL` de la bóveda, `openai/gpt-4o-mini`, copiado sin compararlo con
el `.env.example`; Kevin pidió GLM. Se cambiaron Ajustes → IA de `vocero20`
(llave `…09bd` activa; «Probar conexión» en 2.6 s), el `LLM_MODEL` de
respaldo de Nea en el servicio y el `LLM_MODEL` de la bóveda. Nea se
redesplegó para empezar sin perfil en caché.

| | UTC | Resultado |
|---|---|---|
| Override movido / devuelto | 00:49:02 / 00:52:09 | Los mismos dos mensajes. «pienso con z-ai/glm-5.3-flash». En el 1.º, respuesta en 20.1 s sin herramientas. En el 2.º, `GET /api/bot/availability` y `PUT /api/bot/ficha`, respuesta en 41.1 s. Ninguna llamada a `POST /api/bot/stage`. El lead siguió en «Nuevo» |

**Sigue sin pasar, ahora con dos modelos.** GLM usa otras herramientas
(horarios, ficha) y aun así nunca llama `move_stage`. Por eso no se descarta
que la herramienta no le llegue al modelo, además de una instrucción floja.
Siguiente paso: reproducir fuera de Soporte, con Nea local contra el CRM local
y GLM real, registrando el catálogo que se le manda al modelo. No se mergeó.

**Diagnóstico local y arreglo** (2026-10-21). Se reprodujo en local: el CRM y
Nea de las dos ramas, GLM real y un proxy de registro entre el CRM y
OpenRouter (sin la llave en los registros). `move_stage` sí iba en las
herramientas, y la línea del prompt también; el contexto traía `nextStages`
bien. Lo que fallaba era la instrucción: «cuando la conversación lo amerite»
no le daba al modelo ningún criterio. Arreglo en Nea (`4161f1d`):
- La línea del prompt y la descripción de la herramienta dicen cuándo mover:
  en el mismo turno de la respuesta, en cuanto el lead dijo qué necesita o
  pidió avanzar (precio, contratar, empezar, agendar).
- También dicen cuándo no: un saludo, un «ok» o una duda suelta.
- Prueba nueva: `test_dice_cuando_mover_no_solo_que_se_puede`.

En local, con GLM: mueve con los dos mensajes de la prueba y no mueve con
«Hola, ¿qué tal?». El CRM no cambió.

**En vivo otra vez** (CRM `rc.9`, Nea `rc.10` = `4161f1d`):

| | UTC | Resultado |
|---|---|---|
| Override movido / devuelto | 03:09:26 / 03:09:44 | «Me interesa contratarlos, ¿cómo le hacemos para empezar?» → respuesta en 16.0 s y el lead pasó de «Nuevo» a «Interesado» |

Un mensaje de la línea cliente. Soporte quedó como estaba. **Pasa.**

## 2026-10-20 — Publicación de 2.0.0

Kevin autorizó mergear y publicar `v2.0.0`, primero Nea y luego el CRM, y
mover `latest`.

| Repo | PR | Tag | Imagen (`2.0.0` = `2.0` = `latest`) | Release |
|---|---|---|---|---|
| nea-agent | #49 (CHANGELOG: la 038 y «Actualizar desde 1.x» al día) | `v2.0.0` (`63cf73d`) | `sha256:f3d587d7…ffeee` | «Nea 2.0.0 — el despacho es la única entrada», Latest |
| vocero-crm | #134 (versión, compose sin el perfil `nea`, `init-env` con `BOT_API_KEY`, Render con `vocero-nea`, la imagen 2.0.0 en guías y manifiestos, CHANGELOG con «Actualizar desde 1.6.0») | `v2.0.0` (`97aa639`) | `sha256:af254e93…55b34` | «Vocero CRM 2.0.0 — el agente es un servicio», Latest |

El orden importa: el compose y Render del CRM apuntan a `nea-agent:2.0.0`, así
que esa imagen tenía que existir primero. `latest` lo mueve solo el workflow
`imagen` con un tag sin prerelease (los `rc` no lo tocaron).

Antes del merge, el compose sin perfiles se levantó en una carpeta aparte con
`rc.9` y `rc.10`: CRM y Nea sobre la misma base, el despacho cableado a
`http://nea:8000` con su llave, y Nea con `llm: crm`.

**Pendiente de la 2.0:** starter 3.0.0. `vocero20` sigue con las `rc`
(CRM `rc.9`, Nea `rc.10`, MinIO adentro, GLM en Ajustes → IA); hay que
pasarlo a `2.0.0` o limpiarlo (PLAN-2.0).
