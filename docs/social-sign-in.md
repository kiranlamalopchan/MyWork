# Google and Apple sign-in

The mobile sign-in and registration screens offer both providers. Existing users
connect a provider under **Profile → Settings → Privacy & security**. Matching
email addresses never merge accounts automatically; connect while signed in to
keep existing shifts, posts, and friends.

Both providers use the system authentication browser. Django verifies signed ID
tokens and exchanges authorization codes. Provider credentials stay on Django;
the app receives a single-use, short-lived code protected by a locally held proof.

## Configuration still required

No provider credentials have been created or configured. The current EAS profiles
point to `https://butcher11643.pythonanywhere.com`. Configure the server that those
builds actually use, then deploy these changes and run migrations.

### Google

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview).
   Create/select a project, configure branding, audience, support email, and
   privacy-policy URL. Add test users while the app is in testing.
2. Create an OAuth client with application type **Web application**. This
   integration exchanges codes through Django, including for native apps.
3. Register this exact authorized redirect URI:
   `https://butcher11643.pythonanywhere.com/api/v1/auth/social/google/callback/`
4. Save the client ID and client secret in the server environment below.

The existing Android `google-services.json` is not a replacement for an OAuth
web client secret. See [Google's OpenID Connect setup](https://developers.google.com/identity/openid-connect/openid-connect).

### Apple

1. In [Apple Developer identifiers](https://developer.apple.com/account/resources/identifiers/list),
   enable Sign in with Apple on the primary App ID `com.kiranlama.mywork`.
2. Create a **Services ID** for browser sign-in and associate it with that App ID.
   Use the Services ID as `APPLE_OAUTH_CLIENT_ID`, rather than the iOS bundle ID.
3. Configure the domain `butcher11643.pythonanywhere.com` and return URL
   `https://butcher11643.pythonanywhere.com/api/v1/auth/social/apple/callback/`.
4. Create a Sign in with Apple private key. Keep the downloaded `.p8` file private
   and record its Key ID and your Team ID. Populate the server environment below.

See Apple's instructions for [web sign-in](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)
and [creating the private key](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/).
This implementation uses Apple's browser flow on both platforms.

### Server environment

Set these in the server's private `.env` or environment. Use your actual public
HTTPS origin consistently if it differs from the EAS profiles above. Never put
secrets in `EXPO_PUBLIC_*`, `app.json`, or the mobile bundle.

```dotenv
SOCIAL_AUTH_BASE_URL=https://butcher11643.pythonanywhere.com
GOOGLE_OAUTH_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-google-client-secret
APPLE_OAUTH_CLIENT_ID=your-services-id
APPLE_OAUTH_TEAM_ID=your-team-id
APPLE_OAUTH_KEY_ID=your-key-id
APPLE_OAUTH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_P8_KEY_CONTENT\n-----END PRIVATE KEY-----"
```

Then install `requirements.txt`, run `python manage.py migrate`, and reload Django.
Each provider can be configured independently. An unconfigured provider explains
that password sign-in is available.

Apple refresh tokens are encrypted at rest using a key derived from Django's
`SECRET_KEY`. Keep that key stable and backed up; after rotating it, Apple users
must sign in again to refresh the stored revocation credential. Account deletion
reauthenticates social-only users, then [revokes Apple consent](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
before removing local data. Provider outages leave the account in place for retry.

## Test on an installed app

Use an EAS development/preview build or a store/TestFlight build with the existing
`mywork` URL scheme. [Expo Go does not support OAuth callback schemes](https://docs.expo.dev/guides/authentication/).
The fixed app callback is `mywork://auth-complete`; it does not go into Google's
or Apple's provider redirect settings, which use the HTTPS URLs above.

After configuring the providers, verify real consent, cancellation, a returning
user, Apple Hide My Email, linking to an existing account, and deleting a
social-only account on iOS and Android. Automated tests cover signatures,
issuer/audience/nonce/expiry checks, callback state, proof binding, replay,
account linking, cancellation, deletion, and Apple revocation. Real provider
sign-in remains untested until credentials and an installed build are available.
