# Common rejection patterns and fixes

Use this reference when the user already submitted for App Review and needs to understand why Meta rejected the request.

## Pattern: "The screencast does not match the use case details"

Typical cause:

- The app notes describe a full flow, but the video only shows onboarding or only shows a dashboard.

Fix:

- Re-record the screencast so the product behavior and the written notes match exactly.
- Include onboarding, asset reading, sending, and the recipient device.

## Pattern: Incomplete permission proof

Typical cause:

- `whatsapp_business_management` was requested, but the app never visibly loads phone assets or templates.
- `whatsapp_business_messaging` was requested, but the app never shows a real template send.

Fix:

- Make the critical areas real before reapplying.
- Show those areas clearly in the product UI.

## Pattern: Product looks mocked

Typical cause:

- Core screens contain only static data.

Fix:

- Replace the permission-critical sections with real data:
  - connected number,
  - template list,
  - recent message activity,
  - or real send outcome.

## Pattern: Review build breaks during the flow

Typical cause:

- missing environment variables,
- OAuth mismatch,
- failed code exchange,
- number not operational,
- no approved template available.

Fix:

- Make the review build boringly reliable.
- Remove debug UI from the screencast surface after troubleshooting.

## Approval checklist

- Production route exists and loads.
- Embedded Signup completes.
- Connection persists.
- Number appears in app.
- Template exists and is approved.
- Message is sent from the app.
- Recipient device shows the message.
