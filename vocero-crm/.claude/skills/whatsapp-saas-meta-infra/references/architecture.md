# WhatsApp SaaS reference architecture

Use this reference when the user needs the system-level view.

## Core layers

1. Frontend
2. Backend
3. Meta Graph API / WhatsApp Cloud API
4. Webhook endpoint
5. Supabase

## Recommended flow

1. A business enters the SaaS.
2. The business connects its own WhatsApp Business account through Meta Embedded Signup.
3. Meta returns:
   - authorization code,
   - `waba_id`,
   - `phone_number_id`.
4. The backend exchanges the code for a usable token.
5. The backend stores the connection in Supabase.
6. The app reads:
   - connected phone number,
   - WABA-linked assets,
   - templates.
7. The app sends:
   - approved templates,
   - text replies when the 24-hour window is open.
8. Meta posts statuses and inbound messages to the webhook.
9. The backend stores those events in Supabase.
10. The frontend renders a truthful dashboard from those records.

## Design principle

The product should not behave like a thin wrapper around API calls. The dashboard must reflect real state from:

- Meta assets,
- webhook events,
- and the local persistence layer.
