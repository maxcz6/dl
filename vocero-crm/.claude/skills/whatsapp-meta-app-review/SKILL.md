---
name: whatsapp-meta-app-review
description: Prepare, debug, and resubmit Meta App Review for a WhatsApp SaaS using Embedded Signup, whatsapp_business_management, and whatsapp_business_messaging. Use when drafting permission usage notes, writing screencast scripts, reviewing rejection reasons, building a review-only flow, or turning a partially working WhatsApp SaaS into an approval-ready product.
---

# WhatsApp Meta App Review

Use this skill to convert a WhatsApp SaaS into an approval-ready Meta App Review submission.

## Workflow

1. Identify the exact permissions in scope and the user's current review status.
2. Check whether the product already proves three things inside the app:
   - onboarding through Meta Embedded Signup,
   - reading real WhatsApp assets,
   - sending a real approved template.
3. Read the reference file that matches the task:
   - `references/approved-flow.md` for the approved screencast structure and narration
   - `references/submission-copy.md` for permission notes and reviewer-facing language
   - `references/rejection-patterns.md` for common rejection causes and concrete fixes
4. Produce the smallest useful artifact:
   - revised permission notes,
   - video script,
   - review checklist,
   - review-only page requirements,
   - or rejection remediation plan.

## Guardrails

- Do not recommend requesting permissions before the core path is real.
- Require the app to show actual in-product evidence, not only Postman, n8n, or logs.
- Keep the video linear and short.
- Make the written notes match the screencast exactly.
- Prefer English UI, narration, and reviewer notes unless the user explicitly wants another language.

## Minimum proof standard

Treat these as non-negotiable for approval work:

- the business connects its own account,
- the app reads the connected phone number and templates,
- the app sends an approved template,
- the recipient device shows the delivered message.

## Output style

- Be specific and reviewer-friendly.
- Phrase notes as product behavior, not vague API claims.
- When asked to fix a rejection, map each reviewer complaint to the missing proof in the product or the video.
