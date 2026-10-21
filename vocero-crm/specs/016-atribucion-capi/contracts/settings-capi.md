# Contrato — Ajustes de atribución (`/api/settings/capi`)

Autenticada por sesión (`withAuth`), alcance por organización. **Con la bandera
`ATRIBUCION` apagada, todos estos endpoints responden `404` sin cuerpo**: en esa
instancia no existen.

Errores con el sobre estándar del proyecto: `{ error: { code, message } }`.

---

## `GET /api/settings/capi`

Estado de la conexión.

```jsonc
// Sin configurar
{ "capi": null }

// Configurada
{
  "capi": {
    "datasetId": "1708105527110154",
    "status": "connected",
    "tokenLast4": "a91X",          // NUNCA el token completo
    "qualifiedStageId": "stg_…"     // o null
  }
}
```

## `PUT /api/settings/capi`

Conecta o actualiza. Cuerpo:

```jsonc
{
  "datasetId": "1708105527110154",  // requerido, no vacío
  "token": "EAAG…",                 // OPCIONAL — omitirlo reusa el token de WhatsApp
  "qualifiedStageId": "stg_…"       // opcional; null lo desactiva
}
```

| Caso | Respuesta |
|---|---|
| OK | `200 { "ok": true }` |
| Sin `token` y sin conexión de WhatsApp | `409 sin_whatsapp` |
| `qualifiedStageId` que no es de esta organización | `422 etapa_invalida` |
| Cuerpo inválido | `422 invalid_body` |

**Por qué se reusa el token**: el token del negocio que ya autoriza mensajería es
el mismo que autoriza publicar en su dataset. Pedirlo otra vez solo consigue que
alguien pegue un secreto en un chat.

## `DELETE /api/settings/capi`

`200 { "ok": true }`. Borra dataset y token; deja de reportarse. Los eventos ya
registrados **no** se borran: son la bitácora de lo que se le dijo a Meta.

## `GET /api/settings/capi/events?limit=25`

Actividad reciente, más nueva primero. `limit` 1..50 (default 25); fuera de rango
se recorta, no falla.

```jsonc
{
  "events": [
    {
      "id": "cve_…",
      "conversationId": "cv_…",
      "eventName": "QualifiedLead",
      "contactName": "Marina",       // null si la conversación ya no existe
      "adHeadline": "Kit de verano",  // titular del anuncio, o null
      "status": "sent",              // sent | failed | skipped | pending
      "at": "2026-08-28T18:04:11.000Z",
      "fbTraceId": "AkiF9ptU5s1…",
      "error": null
    }
  ]
}
```

Solo lectura: este endpoint jamás escribe.
