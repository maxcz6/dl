# Plan: Vocero 1.5 y 2.0

Fecha: 2026-10-07. Estado: la 1.5.0 se publicó el 2026-10-08. La sección
2.0.0 se reescribió ese mismo día y se discute en los issues del hito
**2.0.0** del repositorio.

## Por qué

Vocero quiere ser el CRM de WhatsApp que una agencia instala en una tarde y
modifica con la IA que use (Claude Code, Codex, OpenCode): intuitivo, ligero,
desplegable en cualquier servidor y con un agente que se entiende y se prueba.
La 1.4.0 ya hace el trabajo; lo que sigue es ordenarla, bajarle fricción y
dejar de tener el agente partido en dos.

Este plan sale de cuatro auditorías sobre la 1.4.0: un fork de la comunidad
con más pantallas y mejor organización; la edición cloud (vocerocrm.com), que
ya resolvió el arranque y el token de IA desde la interfaz; el agente incluido
contra Nea; y qué tan fácil es desplegar y leer el repositorio.

## Principios que no cambian

1. **Una instancia = un negocio.** Multi-empresa es cosa de la edición cloud.
2. **Solo la Cloud API oficial.** Nada de WhatsApp por código QR: Meta banea
   números y las credenciales quedan en claro.
3. **`/api/bot/*` es un contrato público y se congela.** Quien tenga su propio
   cerebro sigue funcionando en 1.5 y en 2.0.
4. **Un runtime, varios roles.** El agente es uno (recibir, transcribir, leer
   adjuntos, llamar al modelo, ejecutar herramientas, formatear, vigilar). Lo
   que cambia por negocio son datos: instrucciones, herramientas encendidas,
   conocimiento y clientes simulados del Laboratorio.
5. **El CRM es el producto; las capacidades son servicios aparte.** El agente
   es la primera: vive fuera del CRM y habla con él por un contrato. Encender
   una herramienta del agente no exige redesplegar el CRM.
6. **Menor = redesplegar. Mayor = hacer algo a mano** (README, «Versiones»).

## 1.5.0 — todo se actualiza redesplegando

| # | Qué | De dónde | Tamaño |
|---|---|---|---|
| 1 | Menú agrupado y Ajustes en tres secciones: **Canales / Agente / Negocio** | fork de la comunidad (idea) | M |
| 2 | **Guía de inicio**: primera pantalla con 3–4 pasos (agente, token, WhatsApp, agenda) y botón «Encender» | cloud (#91, #78, #95) | M |
| 3 | **Token de IA desde la interfaz**, cifrado, con «Probar conexión», «Traer modelos» y registro de llamadas; las variables de entorno quedan como respaldo | cloud (`ai_credentials`) + fork | M–G |
| 4 | **Registrar el webhook en Meta** al guardar la conexión y botón para desconectar el número | cloud (#75) | M |
| 5 | Plantillas explicadas (idiomas con nombre, ejemplos, vista previa, avisos), 29 monedas, reloj de la agenda en móvil | cloud (#90, #95) | S |
| 6 | **`AGENTS.md`** neutral con el mapa del código; `CLAUDE.md` delega en él | nuevo | S |
| 7 | **`pnpm doctor`** (valida entorno, base, volumen, token) y `docker compose up` sin editar nada (secretos generados, `localhost` por defecto) | nuevo | S |
| 8 | Manifests para Railway, Render y Fly | nuevo | S |
| 9 | Imagen más delgada (sin `drizzle/meta`, mocks fuera del bundle) y `/api/health` con las banderas activas | nuevo | S |
| 10 | Pendientes de seguridad del issue #78 (adjuntos, Next, botones, fixtures) | auditoría 1.4.0 | S–M |

Orden sugerido: 6 → 7 → 9 → 5 → 4 → 3 → 2 → 1 → 8. Primero lo que ayuda a
todo lo demás (que el repo se explique solo), luego lo que baja de cloud, y la
interfaz al final porque depende del token y de la guía.

## 2.0.0 — el CRM es el producto, el agente es un servicio

Hoy el agente vive dos veces: incompleto dentro de Vocero (una llamada por
turno, solo texto) y completo en Nea (fuera, en Python). Y el par está mal
conectado: para poner a Nea delante, Nea tiene que quedarse con el webhook de
Meta, guardar una copia del secreto de la app y relevarle cada mensaje al CRM
con una cola. De ahí salen los incidentes del par, y por eso Instagram y
Messenger se quedan sin agente.

La primera versión de este plan proponía portar a Nea a TypeScript dentro del
CRM. Se descartó el 2026-10-08 por cuatro razones:

- Encender una herramienta del agente no debe exigir redesplegar el CRM.
- Un modelo que se cuelga, un PDF pesado o una transcripción lenta no deben
  competir con la bandeja por el mismo proceso.
- Quien quiere tocar el cerebro lo hace más cómodo en Python que dentro de
  una aplicación de Next.js, y Nea es la pieza del starter que se forkea para
  personalizar el agente.
- La conducta de Nea está fijada en unas 8,000 líneas de pruebas que salieron
  de incidentes reales; una reescritura no las hereda.

Lo que estaba mal no era que el agente viviera fuera, sino cómo estaba
conectado. La 2.0 arregla eso y deja un solo agente: el de fuera.

- **Despacho estándar** (issue #89): el webhook de Meta nunca sale del CRM. El
  mensaje entra a la bandeja y el CRM le despacha la ráfaga al cerebro,
  firmada, como ya hace la edición cloud. WhatsApp, Instagram y Messenger
  despachan igual.
- **Roles como datos** (issue #90): instrucciones + herramientas encendidas +
  conocimiento + personas del Laboratorio, guardados en el CRM y entregados
  por `/api/bot/profile`. En 2.0 solo el **Calificador** (el agente de hoy).
- **Laboratorio por contrato** (issue #91): el cliente simulado escribe, el
  CRM despacha al cerebro como en producción y el juez evalúa lo que vuelve.
  Prueba al cerebro que de verdad contesta, sea Nea o cualquier otro.
- **Retiro del agente incluido** (issue #106): solo cuando el Laboratorio ya
  corre por el contrato. Sin cerebro conectado, Vocero es un CRM de bandeja
  manual; la guía de inicio dice «conecta tu agente» en vez de «enciende el
  agente». *Hecho en la spec 036* (el cerebro piensa por el CRM con
  `/api/bot/llm`).
- **Contrato público** (issue #92): `/api/bot/*` y el despacho documentados
  con OpenAPI, con pruebas gemelas en los dos repositorios, y la guía de
  migración.
- **Nea por despacho** (issue #37 de nea-agent): pierde su webhook de Meta, el
  relay y la cola de reenvío, y se queda con el agente. La edición cloud ya
  funciona así; con 2.0 la raíz y cloud comparten el mismo camino.
- **Adaptador de almacenamiento** (issue #93; `fs` por defecto, S3 opcional):
  la puerta a plataformas sin disco. No depende de lo anterior.

Orden: #89 → #91 → #106, con #90 y #92 en paralelo. El agente incluido no se
toca hasta que el Laboratorio corra por el contrato.

Es Mayor por la regla del README: quien usa el agente incluido tendrá que
desplegar un cerebro junto al CRM. Quien ya corre Nea 1.x delante de Vocero
sigue funcionando; pasar al despacho es devolverle el webhook de Meta al CRM.

## Después (2.1 en adelante)

- **Catálogo de productos** y el rol **Vendedor** (información, precios,
  fotos, apartados).
- **Soporte** (tickets) y **Cobranza** (facturas), cuando haya un negocio
  real que los pida.
- Telegram por la Bot API oficial; TikTok si hay demanda.
- Vercel y similares, cuando el adaptador de almacenamiento y las colas lo
  permitan. Hoy Vocero corre tal cual en cualquier Docker (Coolify, Railway,
  Render, Fly, un VPS).

## Lo que no entra, y por qué

- **WhatsApp por código QR** (Baileys): protocolo no oficial, números
  baneados, credenciales sin cifrar, `git` dentro de la imagen.
- **Userbot de Telegram**: automatiza cuentas personales y guarda sesiones en
  claro.
- **Varias empresas en una instancia**: contradice el principio 1.
- **Portar a Nea dentro del CRM**: fue la primera propuesta de este plan.
  Ahorraba un contenedor, pero ataba cada cambio del agente a un redeploy del
  CRM y obligaba a reescribir una conducta que ya está probada.
- **Orquestador de dos llamadas por turno**: duplica latencia y costo; el
  enrutamiento entre roles se hace por etapa o etiqueta, no con otro modelo.
- **Una pestaña de Ajustes por canal**: con cinco canales son trece pestañas.
