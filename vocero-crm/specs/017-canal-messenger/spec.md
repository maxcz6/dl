# 017 — Canal de Messenger en la bandeja

**Carril**: ciclo completo. Criterio objetivo de la constitución (Principio VI):
toca el modelo de datos (migración: tabla de credenciales y nuevo valor de
`channel`) y una superficie pública (webhook y ajustes del canal).

**Escrito antes del código**, sobre los cimientos que dejó 014: el canal
entra por el mismo camino que Instagram —bandera `CHANNELS`, capacidades
declaradas, adaptador propio, núcleo compartido— y no abre un tercer diseño.

## Problema

Un negocio que atiende por WhatsApp suele tener también una página de
Facebook, y la gente le escribe por Messenger. Hoy esas conversaciones viven
en la bandeja de Meta Business Suite, fuera del pipeline, de la ficha del lead
y del agente. El operador atiende dos bandejas y el agente solo ve la mitad de
las conversaciones.

## Escenarios

1. **Recibir**: un cliente escribe a la página por Messenger; el mensaje
   aparece en la bandeja de Vocero con su distintivo de canal, creando contacto
   y conversación si no existían, con el nombre del perfil (no el PSID crudo).
2. **Responder**: el operador (o el agente) responde desde la misma bandeja y
   el mensaje llega al chat de Messenger del cliente.
3. **Convivir**: WhatsApp e Instagram siguen entrando y saliendo igual que
   antes, en la misma instancia, sin regresión.
4. **Reconocer**: el operador distingue de un vistazo qué conversación es de
   qué canal, y filtra la bandeja por Messenger.
5. **Conectar**: el propietario conecta la página desde Configuración →
   Messenger, probando el token antes de guardarlo, y ve ahí la URL del webhook
   que debe pegar en su app de Meta.

## Requisitos

- **FR-201** `messenger` es un valor válido de `contact.channel` y
  `conversation.channel`; `whatsapp` sigue siendo el default de todo lo
  existente (migración aditiva, sin backfill).
- **FR-202** La identidad de un contacto de Messenger es su PSID (Page-Scoped
  ID), guardada como `fb:<PSID>`, en la misma familia que `bsuid:` e `ig:`.
  Dos canales pueden compartir identidad sin colisionar (el índice único ya
  incluye el canal).
- **FR-203** Las credenciales se guardan cifradas en reposo con el AES-256-GCM
  existente; hacia fuera solo viaja la cola del token. Igual que Instagram,
  admite **dos fuentes** (`source`): la API unificada de **Zernio** (llave +
  `accountRef` + secreto de webhook) o una **app propia de Meta** (`pageId` +
  token de página).
- **FR-204** La ingesta entra por `/api/webhooks/messenger/[webhookToken]`
  con las dos capas de siempre: segmento secreto, y encima la firma — de Meta
  (`x-hub-signature-256` con `META_APP_SECRET`) o de Zernio
  (`X-Zernio-Signature`, HMAC del cuerpo crudo con el secreto de esa cuenta).
  Acepta los dos formatos por la misma URL porque son inconfundibles: Meta
  manda `object: "page"`, Zernio un evento plano con `account`. Es idempotente
  por el id del mensaje y descarta echos, acuses de entrega/lectura, postbacks
  y —en Zernio— **todo lo que no sea la plataforma de Facebook**, porque el
  mismo webhook entrega Instagram, WhatsApp y X. Un adjunto sin texto entra
  con su tipo para que la bandeja enseñe qué llegó.
- **FR-205** El nombre visible sale del evento cuando la fuente lo entrega
  (Zernio manda `name`/`username`); con Meta se consulta al perfil la primera
  vez que se ve un PSID. Si no se puede, cae a «Contacto de Messenger». Nunca
  se bloquea un mensaje por un nombre.
- **FR-206** La salida enruta por canal en `prepareSend` y por fuente dentro
  del canal: Meta envía por `POST /{PAGE_ID}/messages` de Graph con el token
  de la página; Zernio por `POST /inbox/conversations/{id}/messages` con la
  llave y el `conversationId` opaco que guardó la ingesta (con
  `Idempotency-Key` para que un reintento no mande dos veces). No hay
  plantillas; fuera de la ventana de 24 h se usa la etiqueta `HUMAN_AGENT`; el
  texto se limita a 2000 bytes; ubicaciones, contactos y adjuntos salientes
  fallan con un error claro (no un 500).
- **FR-207** Con el canal apagado (`CHANNELS` sin `messenger`), la pantalla,
  el webhook y la API de ajustes responden 404, y la salida por ese canal
  falla claro (ADR-001).
- **FR-208** El Laboratorio sigue sin tocar ninguna API real, tampoco la de
  Messenger: la aserción de `isTest` queda antes de la bifurcación por canal.
- **FR-209** `/api/bot/context` sigue aceptando y devolviendo `waIdentity` sin
  cambios de nombre.

## Criterios de éxito

- Un mensaje real a la página entra a la bandeja con distintivo de Messenger
  y crea un solo contacto con nombre de perfil.
- Una respuesta desde la bandeja llega al chat.
- Un WhatsApp real sigue entrando y saliendo en la misma instancia.
- Los gates del repo pasan en las dos configuraciones de CI (canales apagados
  y encendidos), y el self-test `scripts/e2e-messenger.mjs` queda en verde
  contra el mock de Graph.

## Constitution Check

- **I. Seguridad de datos**: token cifrado en reposo con la clave existente;
  webhook con segmento secreto + firma HMAC; solo el propietario conecta la
  página. Sin secretos en logs.
- **II. Frontera de salida única**: el transporte vive en
  `src/server/messenger/` y usa el cliente único de Graph (`graphRequest`) o el
  de Zernio (`src/server/zernio/`, compartido con Instagram para que la
  verificación de firma tenga UNA sola implementación); el ruteo se decide en
  `prepareSend`.
- **IV. Idempotencia**: dedupe por `fb_<mid>` en el índice único de mensajes;
  migración re-ejecutable.
- **VI. Specs antes de código**: este documento.
- Sandbox del Laboratorio: intacto.

## Fuera de alcance

Adjuntos salientes y descarga de adjuntos entrantes (Messenger los entrega
como URL temporal, no como id de media: exige un camino de descarga distinto
al de WhatsApp), echos de lo que la página manda desde Business Suite,
postbacks y plantillas de botones, indicador de «escribiendo…» y «visto» del
bot externo, y la importación del historial previo. Mensajería de texto,
entrante y saliente, es el alcance.
