# Recommended implementation sequence

Use this reference when the user is building from zero or needs a safe order of operations.

## Phase 1: Meta app and Embedded Signup

- Create the Meta app.
- Configure the WhatsApp product.
- Configure the OAuth redirect URL.
- Implement the frontend launcher for Embedded Signup.
- Capture the returned `code`, `waba_id`, and `phone_number_id`.

## Phase 2: Backend token exchange

- Create a backend endpoint for the code exchange.
- Exchange the Meta code for a usable token.
- Fetch phone metadata after the exchange.
- Persist the connection in Supabase.
- Save `meta_user_id` if available so deauthorize can map back to the local user later.

## Phase 3: Supabase schema

- Create a table for active WhatsApp connections.
- Create a table for message events.
- Add columns for:
  - `message_id`,
  - `direction`,
  - `message_text`,
  - delivery errors,
  - timestamps.

## Phase 4: Sending

- Implement template sending first.
- Implement freeform text sending second.
- Persist the initial outbound event as `accepted`.

## Phase 5: Webhooks

- Implement GET verification.
- Implement POST ingestion.
- Store both:
  - `statuses`,
  - `messages`.

## Phase 6: Dashboard truthfulness

- Show the connected number.
- Show real templates.
- Show recent message events.
- Build conversations from stored events.

## Phase 7: Compliance

- Add a public data deletion instructions page.
- Add a deauthorize callback route.
- Support automatic deletion or unlinking when Meta revokes authorization.
