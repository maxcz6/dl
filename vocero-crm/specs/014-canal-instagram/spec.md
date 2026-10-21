# 014 — Canal de Instagram en la bandeja

**Carril**: ciclo completo. Criterio objetivo de la constitución (Principio VI):
toca el modelo de datos (migración) **y** un contrato publicado
(`/api/bot/context`, que expone `waIdentity`).

## Problema

Vocero es WhatsApp puro en el modelo de datos, no solo en la UI:
`contact.wa_identity` es NOT NULL y único por organización, `conversation` no
tiene canal, la ingesta solo entiende `whatsapp_business_account` y la salida
va siempre a `POST /{phone_number_id}/messages`. Un negocio que vende por
WhatsApp **y** por Instagram tiene que vivir en dos pantallas, y el pipeline,
la ficha y el agente solo ven la mitad de sus conversaciones.

## Escenarios

1. **Recibir**: un cliente manda un DM al perfil de Instagram del negocio; el
   mensaje aparece en la bandeja de Vocero en segundos, con su distintivo de
   canal, creando contacto y conversación si no existían.
2. **Responder**: el operador responde desde la misma bandeja y el mensaje
   llega al DM.
3. **Convivir**: un WhatsApp al número de la misma instancia sigue entrando y
   saliendo igual que antes, sin regresión.
4. **Reconocer**: el operador distingue de un vistazo qué conversación es de
   qué canal.

## Requisitos

- **FR-101** El contacto y la conversación llevan canal (`whatsapp` |
  `instagram`), con `whatsapp` por defecto para todo lo existente.
- **FR-102** La identidad de un contacto de Instagram es su IGSID, guardada
  como `ig:<IGSID>`, análoga al `bsuid:` que ya existe para WhatsApp sin
  teléfono.
- **FR-103** Dos contactos de canales distintos pueden compartir identidad sin
  colisionar (el índice único incluye el canal).
- **FR-104** Las credenciales de Instagram se guardan cifradas en reposo con el
  mismo AES-256-GCM que las de WhatsApp.
- **FR-105** La ingesta acepta dos fuentes —Zernio y Meta directo— por un
  endpoint con segmento secreto, valida la firma cuando hay secreto y es
  idempotente por id de evento.
- **FR-106** La salida enruta por canal de la conversación; Instagram no tiene
  plantillas, y fuera de la ventana de 24 h usa la etiqueta `HUMAN_AGENT`.
- **FR-107** El Laboratorio sigue sin tocar ninguna API real, tampoco la de
  Instagram (Principio: sandbox duro).
- **FR-108** `/api/bot/context` sigue aceptando y devolviendo `waIdentity` sin
  cambios de nombre: hay cerebros externos que dependen de él.

## Criterios de éxito

- Un DM real entra a la bandeja con distintivo de Instagram y crea un solo
  contacto (no uno por mensaje).
- Una respuesta desde la bandeja llega al DM.
- Un WhatsApp real sigue entrando y saliendo en la misma instancia.
- Los gates del repo pasan: typecheck, lint, test, build.

## Constitution Check

- **I. Seguridad de datos**: token cifrado en reposo con la clave existente;
  webhook con segmento secreto + firma HMAC. Sin secretos en logs.
- **II. Frontera de salida única**: el transporte de Instagram vive en
  `src/server/instagram/`, y el ruteo se decide en `prepareSend`, no regado.
- **VI. Specs antes de código**: este documento.
- Sandbox del Laboratorio: la aserción de `isTest` queda ANTES de la
  bifurcación por canal.

## Fuera de alcance

Comentarios, historias, reacciones, automatizaciones de comentario-a-DM,
adjuntos salientes e importación del historial previo. Mensajería de texto,
entrante y saliente, es el alcance.
