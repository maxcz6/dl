# Meta configuration checklist

Use this reference when the user needs the configuration values and URLs that must exist in Meta Developers.

## OAuth / Embedded Signup

The app should expose a public callback page such as:

```text
https://your-domain.com/oauth/callback
```

This URL should be:

- listed in valid OAuth redirect URIs,
- reachable in production,
- consistent with the runtime environment.

## WhatsApp webhook

Use a public route such as:

```text
https://your-domain.com/api/whatsapp/webhook
```

Requirements:

- GET for verification
- POST for webhook events
- verify token stored as an environment variable
- subscribe to the `messages` field

## Data deletion instructions URL

Use a public page such as:

```text
https://your-domain.com/data-deletion
```

This page should explain how users can request deletion and how your team processes it.

## Deauthorize callback URL

Use a backend route such as:

```text
https://your-domain.com/api/meta/deauthorize
```

This route should:

- receive Meta's deauthorize callback,
- validate `signed_request`,
- identify the local user,
- delete or unlink the user's WhatsApp data,
- return a confirmation response.

## Critical environment variables

- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`
- `FACEBOOK_CONFIG_ID`
- `OAUTH_REDIRECT_URI`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

## Common config failures

- redirect URI mismatch
- wrong app secret
- app ID, app secret, and config ID from different apps
- webhook URL not publicly reachable
- deauthorize callback exists in Meta but not in the product
