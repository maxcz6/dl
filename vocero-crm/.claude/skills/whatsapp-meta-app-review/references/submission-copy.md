# Submission copy for Meta App Review

Use this reference when asked to draft permission notes, reviewer explanations, or English copy for the submission form.

## `whatsapp_business_messaging`

```text
This app uses whatsapp_business_messaging to send subscription payment reminder messages from the customer's own connected WhatsApp Business phone number.

Our users are businesses that manage recurring subscriptions or renewals. Inside the app, the business connects its own WhatsApp Business account through the official Meta Embedded Signup flow. After the connection is completed, the app stores the connected WhatsApp Business Account ID and Phone Number ID and then uses approved WhatsApp message templates to send payment reminder notifications to opted-in end customers.

This permission is used only after the business connects its account and only for sending business notifications related to subscription renewal or payment reminder use cases.
```

## `whatsapp_business_management`

```text
This app uses whatsapp_business_management to retrieve and manage the WhatsApp Business assets required for the platform after the business connects through Meta Embedded Signup.

After the user completes the Embedded Signup flow, the app reads the connected WhatsApp Business Account information, the connected Phone Number ID, and the WhatsApp message templates associated with that account. This information is used to configure the workspace inside the app and allow the business to select approved templates and operate its reminder workflows.

This permission is used only to read and manage the WhatsApp Business assets necessary for the business to operate its own connected account inside the platform.
```

## Video notes block

```text
The video shows:
1. The complete Meta Embedded Signup flow.
2. The user granting access to the requested permissions.
3. The connected business phone number displayed inside the app.
4. The list of WhatsApp templates loaded from the connected account.
5. A live approved template message being sent to a test recipient.
6. The final message received on the recipient device.
```

## Writing rules

- Describe product behavior, not generic API usage.
- Mention the business connects its own account.
- Mention approved templates.
- Mention the connected phone number and IDs.
- Match the video exactly.
