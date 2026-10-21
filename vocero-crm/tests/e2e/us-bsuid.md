# E2E — 003 Identidad resiliente (BSUID)

Precondición: app corriendo con mocks (`WA_MOCK_ENABLED=true`,
`META_GRAPH_BASE_URL` → wa-mock), organización creada y conexión WhatsApp
guardada (wizard con credenciales del mock).

## Camino feliz: inbound sin wa_id

1. `POST /api/dev/wa-mock/inbound` con `{phoneNumberId, fromUserId: "bsu_e2e_1",
   name: "Dueña Dental", text: "hola, vi su anuncio"}` (sin `from`).
2. En la bandeja: aparece la conversación "Dueña Dental" (NO "bsu_e2e_1") con el
   mensaje, en ≤2 s (SSE).
3. Panel de contacto: muestra "Sin teléfono".
4. Responder desde el composer → el mensaje sale; en el outbox del wa-mock el
   destinatario es `bsu_e2e_1` (el BSUID, no un teléfono).
5. Re-entregar el MISMO payload (mismo `waMessageId`) → sin duplicados.

## Reconciliación

6. `POST inbound` con `{from: "5215550001234", name: "Kevin"}` → contacto A.
7. `POST inbound` con `{from: "525550001234", text: "sigo yo"}` → MISMO contacto
   A (no aparece un segundo contacto; normalización 521→52 en ingest).
8. `POST inbound` con `{from: "525550001234", fromUserId: "bsu_kevin"}` →
   contacto A adquiere el BSUID (verificable respondiendo tras simular pérdida
   del teléfono — fuera de alcance UI; verificar por API/DB).

## Camino infeliz

9. `POST inbound` con payload sin `from` NI `fromUserId` (construir a mano
   contra el webhook con firma válida) → 200, log de advertencia, la bandeja
   NO muestra nada nuevo y la app sigue viva.
