---
name: whatsapp-saas-meta-infra
description: Implement and troubleshoot WhatsApp SaaS infrastructure on Meta Graph API and WhatsApp Cloud API. Use when building Embedded Signup, OAuth callbacks, webhook verification, message status handling, data deletion or deauthorize callbacks, Supabase persistence, or Vercel deployment for a product where each customer connects their own WhatsApp Business account.
---

# WhatsApp SaaS Meta Infra

Use this skill to build the infrastructure layer of a WhatsApp SaaS, not just isolated API calls.

## Workflow

1. Identify the missing layer:
   - Meta app configuration,
   - Embedded Signup,
   - token exchange,
   - webhook ingestion,
   - Supabase schema,
   - message sending,
   - or data deletion / deauthorize handling.
2. Read the matching reference file:
   - `references/architecture.md` for the overall system design
   - `references/implementation-sequence.md` for the recommended build order
   - `references/meta-config.md` for Meta app settings, callback URLs, and review-facing config
   - `references/api-blueprint.md` for backend route contracts and responsibilities
   - `references/supabase-schema.md` for SQL and data modeling
3. Implement the missing layer in the user's stack.
4. Validate the full chain, not only the isolated endpoint.

## Guardrails

- Keep secrets server-side.
- Do not equate `accepted` with `delivered`.
- Save enough identity data to support deauthorize callbacks later.
- Make webhooks idempotent and upsert by `message_id`.
- Revalidate local connection state against Meta when assets may have been deleted.

## Minimum infrastructure standard

Treat these as the baseline:

- a real OAuth or Embedded Signup completion path,
- a backend code exchange endpoint,
- a webhook with GET verification and POST ingestion,
- Supabase tables for connections and message events,
- real message send actions,
- message status persistence,
- a deauthorize or data deletion path for compliance.

## Output style

- Favor architecture and implementation order over scattered snippets.
- Show which part runs in frontend, backend, Meta, and database.
- When writing code, produce production-leaning defaults rather than demo-only code.
