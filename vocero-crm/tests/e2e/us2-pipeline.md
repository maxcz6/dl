# Guion E2E — US2: Contactos y pipeline kanban

> Conducido con Playwright (MCP) contra `pnpm dev` con el entorno de pruebas
> interno. Continúa el estado del guion de US1 (contactos ya creados por
> mensajes entrantes).

## Auto-registro (FR-010)

1. Abrir `/contacts`.
   ✅ Los remitentes de US1 ("Cliente E2E", "Cliente Frio") existen como
   contactos con su nombre de perfil y teléfono.
2. Abrir `/pipeline`.
   ✅ Cada contacto tiene su tarjeta en la etapa "Nuevo" con última actividad.

## Kanban (FR-011/FR-012)

3. Arrastrar la tarjeta "Cliente E2E" de "Nuevo" a "En conversación".
   ✅ La tarjeta cambia de columna.
4. Recargar la página.
   ✅ La tarjeta sigue en "En conversación" (persistencia).
5. La tarjeta muestra contacto + última actividad + enlace que abre su
   conversación en la bandeja (`/inbox?contact=...`).

## Gestión de etapas (FR-011)

6. "Gestionar etapas": renombrar una etapa, agregar "Cotizado", verificar que
   las anclas ganado/perdido no se pueden eliminar.
7. Eliminar "Cotizado" (vacía) → desaparece.

## Bitácora de etapas

Automatizado en `scripts/e2e-bitacora-etapas.mjs`. El tablero dice dónde está
cada lead HOY; la bitácora es lo que permite preguntar qué pasó antes.

8. **Nace con su evento**: provocar un entrante de un número nuevo.
   ✅ El lead aparece en la primera etapa y su primer movimiento queda
   registrado (sin etapa de origen).
9. **Mover deja renglón**: arrastrar la tarjeta a otra columna.
   ✅ Queda un movimiento con de-dónde, a-dónde, cuándo y quién lo movió.
   ✅ Reordenar dentro de la MISMA columna no inventa un movimiento.
10. **Perder exige motivo**: arrastrar a la etapa perdida.
    ✅ Se abre el diálogo. Si se cancela, la tarjeta ni se movió.
    ✅ Por API sin motivo → **422** `loss_reason_required`, y el lead se queda
    donde estaba.
    ✅ Con motivo → el motivo y la nota quedan en la bitácora.
    ✅ Un INSERT directo en la base de un movimiento a "perdido" sin motivo lo
    rechaza el CHECK `lse_loss_reason_ck`: la regla no depende de la ruta.
11. **Todos los caminos pasan por la puerta**: `POST /api/bot/reset` deja su
    movimiento como `sistema`, y eliminar una etapa con reubicación deja un
    evento por cada lead reubicado.

## Alta manual de prospectos

Automatizado en `scripts/e2e-alta-manual.mjs`. El embudo ya no depende de que
la gente llegue por WhatsApp.

12. **"Nuevo contacto"** en Contactos: nombre, teléfono, fuente y etapa inicial.
    ✅ El prospecto aparece en el **Pipeline**, en la etapa elegida — no solo en
    la lista de contactos.
    ✅ Su nacimiento queda en la bitácora marcado como capturado por el dueño.
13. **El teléfono exige código de país.** Un número local crearía un contacto
    que jamás casaría con los mensajes entrantes, porque Meta manda la identidad
    completa.
    ✅ Con guiones o letras → **422** explicando la regla.
    ✅ Un teléfono repetido → **409**, y se ofrece abrir a quien ya existe en vez
    de un error seco.
14. **La fuente capturada manda; lo que nadie capturó no se inventa.**
    ✅ Quien llegó por WhatsApp queda "sin identificar" y marcado como deducido.
    ✅ La etiqueta de fuente solo se muestra cuando alguien la capturó.
15. **Escribir primero**: el botón de enviar abre el panel de plantillas.
    ✅ Solo plantillas aprobadas: iniciar con texto libre lo prohíbe Meta.
    ✅ Con la ventana de 24 h abierta se avisa en vez de gastar una plantilla.

## Monto de la negociación

Automatizado en `scripts/e2e-monto-pipeline.mjs`. El tablero cuenta personas;
esto le agrega cuánto dinero hay en cada columna.

16. **Capturar el monto** desde la tarjeta ("+ monto").
    ✅ Acepta lo que uno teclea: `12500`, `12,500.50`, `$12 500`.
    ✅ Guardarlo **no mueve** la tarjeta, y mover la tarjeta no borra el monto.
    ✅ Vacío borra el monto: un trato sin número no vale cero, no se sabe.
17. **Total por columna** al pie de cada etapa.
    ✅ Suma solo la moneda del negocio, en centavos enteros.
    ✅ Sin montos capturados dice "Sin montos capturados" — un `$0.00` se lee
    como un error del sistema, no como un dato.
    ✅ Si hay importes en otra moneda, lo **dice** en vez de descartarlos en
    silencio.
18. **La moneda se elige** en Ajustes → Marca.
    ✅ El tablero la refleja.
    ✅ Un importe ya capturado conserva la suya: cambiar el ajuste no
    reinterpreta pesos como dólares.

## Prioridad

Automatizado en `scripts/e2e-prioridad.mjs`. A quién llamar primero.

19. **La fija el dueño** desde la tarjeta (Alta / Media / Baja).
    ✅ Un lead nuevo nace **sin** prioridad — no con una "media" inventada.
    ✅ Se puede **quitar**: un clic por error no queda para siempre.
20. **Nada la escribe solo.** Mover la tarjeta de etapa, capturar el monto o
    recibir un mensaje del cliente NO la cambian. Es la única forma de que el
    dueño pueda confiar en que lo que ve es lo que él puso.
21. **Se ve donde se trabaja**: etiqueta en la tarjeta del Pipeline y en la
    lista de Contactos, que además ordena alta primero y deja al final a quien
    no tiene prioridad.

## El trato, abierto desde el tablero

Conducido con Playwright (MCP). No trae guion automatizado propio a propósito:
el cajón no agrega comportamiento de servidor — usa los mismos endpoints que ya
cubren `e2e-monto-pipeline`, `e2e-prioridad`, `e2e-bitacora-etapas` y
`e2e-ficha-lead`. Lo que se verifica aquí es el cableado.

22. **Clic en la tarjeta** (en el cuerpo, no en un control).
    ✅ Abre un cajón con quién es, monto, prioridad, etapa y ficha, sin salir
    del tablero.
    ✅ **Arrastrar sigue funcionando**: el sensor solo activa el arrastre a los
    6 px, así que un clic quieto nunca llega a serlo.
    ✅ Y soltar tras arrastrar **no** abre el cajón.
    ✅ Tocar "+ monto" en la tarjeta abre su diálogo y NO además el cajón.
    ✅ Escape lo cierra; en móvil ocupa 345 px de 375 sin scroll horizontal.
23. **Se edita desde dentro** y el tablero lo refleja al instante.
    ✅ Prioridad, monto y etapa se guardan sin cerrar el cajón.
    ✅ El cajón lee del tablero, no de una copia: lo que se cambia se ve.
24. **Perder exige motivo también desde aquí.** Es la misma puerta que el
    arrastre, no una segunda regla que se puede olvidar.
    ✅ Mover a la etapa perdida abre el diálogo de motivo por encima del cajón.
    ✅ Si se cancela, el lead se queda donde estaba y el cajón sigue abierto.

## Contactos (FR-013)

22. Buscar por "Frio" → filtra; editar notas → persiste; archivar → desaparece
    de la lista (visible con "Ver archivados"); desarchivar → vuelve.
