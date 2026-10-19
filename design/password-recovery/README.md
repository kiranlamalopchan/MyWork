# Password recovery verification

- `request-ready.png`: real email-request page at a 390px mobile viewport.
- `complete.png`: successful password change.
- `reset-walkthrough.webm`: browser request → file-delivered email link → new
  password → successful sign-in → rejection of the used link.

The browser walkthrough used an isolated SQLite database and Django's file
email backend. No external emails were sent. The emailed URL was read from
the private temporary outbox; no API key or live account was used. The test
confirmed that the token is hidden before the new-password form is shown,
and reported no browser JavaScript errors. The form has no horizontal
overflow at 390px. Browser QA also caught and resolved a Chrome CSRF failure
caused by an overly restrictive referrer policy.

Validation: 209 account/API tests passed; 33 recovery/admin-link tests passed
after the referrer-policy correction. All 194 native tests passed, along
with TypeScript and lint (24 existing warnings, no errors). Android and iOS
Expo exports passed. Django system checks and `git diff --check` passed.

The complete server run executed 891 tests with two failures in
`PaidUpToADateOnACycleTests`, in the payment-date behavior outside this
password-recovery change. Those failures are not resolved by this work.

Live Brevo delivery has not been tested or configured. Follow
[the setup guide](../../docs/password-recovery.md) to verify a sender, add
the private API key on PythonAnywhere, reload, and test actual delivery.
The native button requires an updated installed build; an Expo export does
not install or publish one.
