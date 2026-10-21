# E2E — Ajustes → Canales y arreglos de Zernio (023)

Arnés: `scripts/e2e-canales.mjs`. Spec:
[`specs/023-ajustes-canales/spec.md`](../../specs/023-ajustes-canales/spec.md).

Precondición: app corriendo (`next dev`) sobre una base migrada, con
`CHANNELS=whatsapp,instagram,messenger,tiktok`, `WA_MOCK_ENABLED=true` y
`ZERNIO_BASE_URL` → zernio-mock. No hace falta el agente.

El arnés hace de **propietario** (guarda las conexiones por las mismas rutas
que usan las pantallas) y de **Zernio**: le dice al simulador qué cuentas y qué
webhooks tiene la llave (`POST /api/dev/zernio-mock/_accounts`, `_webhooks`),
lo tira (`_down`), entrega eventos firmados y lee lo que el CRM dejó en él
(`GET /api/dev/zernio-mock/_state`).

```bash
node --env-file=.env scripts/e2e-canales.mjs
```

## D1 — La cuenta se resuelve contra la llave

1. Llave que Zernio rechaza → 422 `invalid_token`.
2. Sin `accountRef` y con una sola cuenta de Instagram → 200 con esa cuenta;
   la conexión guarda su usuario y el id de Instagram que da Zernio.
3. Con el id del **perfil** → se guarda el de la cuenta.
4. Con la cuenta de Facebook, o con un id que no existe → 422
   `unknown_account` que dice cuál sirve; la conexión buena sigue intacta.
5. Con dos cuentas de Instagram en la llave → 422 `choose_account` con las
   dos en `error.details.accounts`; eligiendo una → 200.
6. Con Zernio caído → 503 `platform_unavailable`, no «llave inválida».
7. Con una app propia de Meta el ID de la cuenta sigue siendo obligatorio.

## D7 — Solo el propietario conecta

8. Una persona del equipo recibe 403 al guardar Instagram, Messenger o TikTok
   y al reparar el webhook. Sí puede ver el estado (`canManage: false`).

## D4 — El webhook se da de alta solo

9. Al conectar Instagram, Zernio queda con **un** webhook hacia esta
   instancia: activo, con `message.received`, limitado a las cuentas
   conectadas y con un secreto generado. La respuesta no trae llave ni secreto.
10. Al conectar Messenger (sin `accountRef`: se toma la página, con su nombre
    y su id) es el **mismo** webhook, con las dos cuentas y el mismo secreto.
11. TikTok personal se conecta, pero la respuesta avisa que no recibirá
    mensajes hasta ser Business. El webhook queda con las tres cuentas.
12. Un webhook ajeno de esa llave (otra URL) sigue exactamente igual.
13. Si Zernio falla al registrar, la conexión se guarda y el fallo se dice
    (`webhook.ok: false`, `zernio_unavailable`).

## D3 — La firma

14. Instagram bien firmado → 200 y entra a la bandeja. Firma rota o ausente →
    401.
15. Messenger firmado con el mismo secreto, por la URL de Instagram → 200 y
    entra como Messenger.
16. El secreto cambia en Zernio sin que el CRM lo sepa → la entrega firmada
    con el nuevo se acepta (se lee de Zernio con la llave guardada).
17. Ni las entregas buenas ni las firmas inválidas vuelven a preguntarle a
    Zernio dentro del minuto (caché). Un secreto de nadie → 401. El guardado
    sigue valiendo.
18. Con Zernio caído: un secreto que el CRM no conoce → 401; el guardado → 200.
19. Un evento de una cuenta que nadie conectó aquí → 200 y no se ingiere.

## D2 — Autocuración

20. Una conexión de Messenger guardada con el id del perfil: un evento sin
    firma válida no la corrige (401); el mismo evento bien firmado entra a la
    bandeja y deja la conexión con el id de la cuenta.

## D5 — Estado

21. `GET /api/settings/channels`: una fila por canal encendido, WhatsApp
    primero. Instagram con su cuenta, su último mensaje y cuenta y webhook
    sanos. Messenger con la cuenta que Zernio marca para reconectar, en error.
    TikTok personal, en error y diciendo por qué. Sin llave, secreto ni
    segmento del webhook en la respuesta.
22. Webhook desactivado → error en los tres; «reparar» lo reactiva sin crear
    otro. Webhook sin una cuenta → error en esa. Fallos de entrega → aviso con
    la hora del último disparo. Sin webhook → error; «reparar» lo crea con las
    tres cuentas y el secreto que el CRM ya tenía.
23. Con Zernio caído la pantalla carga y lo dice, sin inventar un «todo bien».
24. TikTok ya Business: al reconectar deja de avisar y los tres quedan sanos.

## 030 — El secreto en reposo

25. Al final, en la base: ninguna fila de `instagram_credentials`,
    `messenger_credentials` ni `tiktok_credentials` tiene `webhook_secret`;
    las de Zernio tienen `webhook_secret_{cipher,iv,tag}`, y ninguna fila
    contiene el secreto del webhook como texto.

## Interfaz (a mano, claro y oscuro)

- **Configuración → Estado**: el distintivo de cada canal dice lo peor que le
  pasa («Con problemas», «Revisar»), no «Conectado» encima de un error.
- **Configuración → Instagram**: pegar la llave y «Probar y conectar». Con
  varias cuentas, elegir una de los botones. Al terminar dice qué cuenta quedó
  y qué pasó con el webhook.
- En móvil la pantalla de estado no desborda el ancho.
