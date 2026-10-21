# Supabase schema for a WhatsApp SaaS

Use this reference when the user needs a minimal but production-leaning data model.

## Table: whatsapp_connections

Purpose:

- store the current connected WhatsApp Business account for a SaaS user.

```sql
create extension if not exists "uuid-ossp";

create table if not exists public.whatsapp_connections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  waba_id text not null,
  phone_number_id text not null,
  display_phone_number text,
  verified_name text,
  access_token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Table: whatsapp_message_events

Purpose:

- store outbound sends,
- delivery statuses,
- inbound messages,
- debugging context.

```sql
create table if not exists public.whatsapp_message_events (
  id uuid primary key default uuid_generate_v4(),
  waba_id text,
  phone_number_id text,
  message_id text not null unique,
  recipient_phone text,
  template_name text,
  direction text not null default 'outbound',
  message_text text,
  status text not null,
  error_code text,
  error_title text,
  error_message text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_event_at timestamptz not null default now()
);
```

## Why this schema works

- `phone_number_id` ties events to the connected sender.
- `message_id` supports upserts from webhook updates.
- `direction` supports conversation rendering.
- `message_text` supports inbound conversation truth.
- `raw_payload` keeps enough context for debugging.

## Suggested operational rules

- Insert outbound events immediately after a successful send response.
- Update the same row when webhook statuses arrive.
- Insert inbound messages as new rows with `direction = inbound`.
- Mark stale or broken connections as inactive if Meta says the asset is gone.
