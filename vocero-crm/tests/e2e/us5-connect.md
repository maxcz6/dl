# Guion E2E — US5: Conexión del número (wizard)

> Conducido con Playwright (MCP) contra `pnpm dev` con wa-mock
> (`META_GRAPH_BASE_URL` → wa-mock/graph).

## Camino feliz

1. Abrir `/settings/whatsapp`.
   ✅ El wizard explica los DOS orígenes del token (modo directo / modo
   agencia Tech Provider).
2. Llenar WABA ID + Phone Number ID + token (sin sufijo `-invalid`) →
   "Probar conexión".
   ✅ "Token válido para +52 …". El botón Guardar se habilita SOLO tras la
   prueba.
3. Guardar.
   ✅ Estado "Conectado" con display number y token …last4; el token quedó
   cifrado en BD (unit test) y, como la WABA no tenía override, se suscribió
   la app con subscribed_apps y se registró el webhook de la instancia en el
   NÚMERO (override del número, con handshake de Meta). Bajo el formulario:
   «Webhook registrado en Meta…». Automatizado en `scripts/e2e-selftest.mjs`
   (sección "us5"), que lee lo registrado en `GET /api/dev/wa-mock/webhooks`.
4. Sección Webhook:
   ✅ URL COMPLETA con el verify token como segmento + botón copiar (respaldo
   manual); botón «Registrar en Meta» que repite el registro con la conexión
   guardada, sin volver a pegar el token; aviso informativo (no error) si
   META_APP_SECRET no está configurado; nota de seguridad del token en la URL.
4b. «Desconectar» en la tarjeta del número conectado → confirmación («Dejarás
   de recibir y enviar. Tus conversaciones se quedan.») → Sí, desconectar.
   ✅ La conexión desaparece, el override del número se quitó en Meta
   (`phoneWebhooks` del mock sin el número) y la bandeja sigue intacta.

## Caminos infelices

5. Token con sufijo `-invalid` → "Probar conexión".
   ✅ Error claro de token inválido; NO se guarda (la conexión previa queda
   intacta).
6. Webhook GET handshake con verify token correcto → challenge; segmento
   incorrecto → 404 (cubierto también en guion US1).
7. La WABA ya enruta a un override (cerebro externo como Nea, o el backend de
   una agencia) → rotar el token y Guardar.
   ✅ Guarda igual, y el override SIGUE en `GET {WABA}/subscribed_apps`: el CRM
   lo consulta antes y no re-suscribe, porque en Meta un POST sin cuerpo borra
   el override. Tampoco registra el webhook del número —ese gana al de la WABA
   y dejaría sordo al cerebro externo—: si un guardado anterior lo había
   dejado, lo quita, y el aviso dice a qué host se respeta. Automatizado en
   `scripts/e2e-selftest.mjs` (sección "us5"), con un control de que el
   wa-mock sí lo borra ante ese POST.
8. Token con sufijo `-sin-gestion` (sin `whatsapp_business_management`) →
   Guardar.
   ✅ La conexión se guarda (200) y el aviso bajo el formulario dice que no se
   pudo registrar el webhook y por qué; «Registrar en Meta» responde 422 con
   el mismo motivo. Con un token normal, el botón vuelve a dejarlo registrado.
