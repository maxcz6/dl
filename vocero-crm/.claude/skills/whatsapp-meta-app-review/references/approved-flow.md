# Approved flow for Meta App Review

Use this reference when the task is to script, review, or rebuild the exact flow that should appear in the submission video.

## Approved narrative pattern

The strongest flow is:

1. Introduce the product and use case in one sentence.
2. Run the full Meta Embedded Signup flow.
3. Return to the app and show the connected phone number and IDs.
4. Create a new reminder template.
5. Show the template in pending or approved state.
6. Send the approved template to a test recipient.
7. Show the message on the recipient device.

## Approved example script

Use this exact sequence as a baseline:

```text
This is Suscripta, a SaaS for subscription payment reminders on WhatsApp.
First, the business connects its own WhatsApp Business account through Meta Embedded Signup.

After the connection, Suscripta reads the connected phone numbers and their IDs.
Here is the connection established.

I will create a new template of a subscription reminder.
Now I will send this template to the approval process in Meta.
Here I can see this template with the pending status.
Now I will send the approved template to a test recipient.

The message was sent successfully and here it is on the recipient device.
```

## What each step proves

- Embedded Signup proves the user is connecting their own business account.
- Reading the phone number and IDs proves asset access through `whatsapp_business_management`.
- Creating and listing templates proves the app is operating on real WhatsApp Business assets.
- Sending the approved template proves `whatsapp_business_messaging`.
- Showing the recipient device proves the end-to-end use case.

## Video constraints

- Keep it linear.
- Avoid detours into debugging tools.
- Avoid admin setup that the reviewer does not need.
- Target 2 to 4 minutes.
- Show the real recipient device whenever possible.
