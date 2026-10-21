# Backend API blueprint

Use this reference when the user wants concrete backend responsibilities and route design.

## Recommended routes

### 1. Code exchange endpoint

Example:

```text
POST /api/whatsapp/exchange-token
```

Input:

- `code`
- `waba_id`
- `phone_number_id`

Responsibilities:

- validate the request,
- exchange the code with Meta,
- fetch connected phone metadata,
- persist the active connection,
- optionally store `meta_user_id`.

## 2. WhatsApp webhook

Example:

```text
GET  /api/whatsapp/webhook
POST /api/whatsapp/webhook
```

GET responsibilities:

- verify `hub.verify_token`,
- return `hub.challenge`.

POST responsibilities:

- parse each `entry`,
- parse each `change`,
- process `value.statuses`,
- process `value.messages`,
- upsert by `message_id`.

## 3. Send template message

Example:

```text
POST /api/whatsapp/send-template
```

Input:

- recipient phone
- approved template name
- language code
- template parameters

Responsibilities:

- normalize the phone,
- send the message through Meta,
- store an initial outbound event as `accepted`.

## 4. Send freeform text message

Example:

```text
POST /api/whatsapp/send-text
```

Use this only for open customer service windows.

## 5. Deauthorize callback

Example:

```text
GET  /api/meta/deauthorize
POST /api/meta/deauthorize
```

Responsibilities:

- read `signed_request`,
- validate it with `HMAC-SHA256` and the app secret,
- extract the Meta user identifier,
- map it to the local user,
- purge or unlink WhatsApp data,
- return a confirmation payload.

## Important behavior

- Store only metadata and tokens server-side.
- Never trust the UI as source of truth for message delivery.
- Use idempotent writes for webhook processing.
