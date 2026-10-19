# Password recovery on PythonAnywhere free

Web and native sign-in now offer **Forgot password?**. Users enter the email
saved on their account, receive a one-use link, and choose a new password in
their browser. Links expire after one hour. Changing the password signs out
existing browser sessions and native tokens. Accounts without an email can
still receive a reset link from an admin.

## Activate email delivery

1. Create a [Brevo account](https://www.brevo.com/) and complete its account
   verification and any transactional-email activation requested by Brevo.
2. In **Settings → Senders, Domains, IPs → Senders**, add your Gmail address
   with the sender name **KaamKoRecord**. Confirm the verification code sent
   to that inbox. [Brevo's sender instructions](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).
3. Create a **v3 API key** in Brevo's **SMTP & API → API Keys** settings.
   Use the API key, not an SMTP password. Keep it private.
4. Add these entries to the existing project `.env` on PythonAnywhere. Replace
   all three placeholders; retain the other existing settings:

   ```dotenv
   BREVO_API_KEY=your-private-brevo-api-key
   DEFAULT_FROM_EMAIL=KaamKoRecord <your-verified-address@gmail.com>
   PASSWORD_RESET_BASE_URL=https://yourusername.pythonanywhere.com
   ```

   The base URL must be the public HTTPS origin serving this Django project,
   without a path. It controls the links in emails, independently of the
   sender address. Never put the API key in mobile configuration or Git.
5. In a PythonAnywhere Bash console, activate the project's virtualenv, change
   to the project directory, and run:

   ```sh
   python manage.py check_password_recovery
   ```

   This checks configuration only; it does not contact Brevo or send email.
6. Reload the application from PythonAnywhere's **Web** tab. Save your email
   under **Profile → Edit**, then sign out and use **Forgot password?**.
   Confirm delivery, check spam if needed, and complete one reset. Sign in
   again on your devices using the new password. The native sign-in button
   requires a mobile build containing this change.

No owned sender domain is required for this setup under Brevo's currently
documented behavior: it replaces free-provider sender domains such as Gmail
with a Brevo sending domain. The From address may therefore appear as
`@…brevosend.com`. Brevo describes this as temporary support; delivery still
depends on account approval, sender verification, and provider limits.
[Brevo's explanation](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

The app uses Brevo's HTTPS API, which is on
[PythonAnywhere's free-account allowlist](https://www.pythonanywhere.com/whitelist/).
It uses the platform's normal proxy environment; SMTP ports are unnecessary.
[API reference](https://developers.brevo.com/reference/send-transac-email).

## Troubleshooting

- **Email reset is not available yet:** check all three settings and reload
  the app. The production base URL must use HTTPS and the sender must be a
  valid email address.
- **Check your email but nothing arrives:** verify that the account has that
  email saved and can sign in with a password. Check Brevo's transactional
  logs for delivery/rejection, sender verification, activation, and quota.
  The app deliberately gives the same response for registered and unknown
  addresses. Provider failures are logged without credentials or reset links.
- **Please wait a minute:** requests for the same email have a 60-second
  cooldown. An IP is limited to 20 requests per 15 minutes. Limits use the
  configured Django cache; the default local cache applies per worker.
- **Expired link:** request another link. A completed reset invalidates
  earlier links automatically.
- **No email saved:** ask an admin for a reset link, then save an email in
  Profile after signing in. New registrations can also provide an email.

Local development and tests can override `EMAIL_BACKEND` with Django's
file/locmem backend and set an HTTP localhost base URL while `DEBUG=True`.
Do not use a file, console, or dummy backend for production delivery.
