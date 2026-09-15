# MyWork for Android and iOS

The native app: Expo (React Native, TypeScript, Expo Router). It talks to
the Django site through `/api/v1/` (see `apps/api` in the repo root) with a
token, and shows the same things the site does — the hub, the notice
board, stories, the inbox with push, PLU lookup, your profile and the
holidays. Timesheets and photo search open the site itself for now (phase
2 brings them into the app).

## Running it on your phone

1. In the repo root, run the site so the phone can reach it on the Wi-Fi:

       python manage.py runserver 0.0.0.0:8000

2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your
   laptop's address, e.g. `http://192.168.1.10:8000` (`ipconfig getifaddr en0`
   on a Mac). For the live site use `https://butcher11643.pythonanywhere.com`.

3. `npm install`, then `npx expo start`. Install **Expo Go** from the App
   Store / Play Store and scan the QR code.

Push notifications need a *development build* rather than Expo Go (Expo
Go on Android no longer receives them): `npx eas login`, then
`npx eas build --profile development --platform android` (or `ios`) and
install what it produces. `eas.json` carries the profiles; each points at
the live site.

## Working on it

    npm run typecheck     # tsc
    npm test              # jest: the API client, path mapping, hue maths
    npm run web           # the same screens in a browser, for a quick look

Layout: `app/` is the routes (Expo Router — a file is a screen), `src/api`
the typed calls and react-query hooks, `src/auth` the token and session,
`src/push` registering the phone, `src/nav/paths.ts` how the site's paths
(what a notification carries) map to screens, `src/ui` the theme (the
site's own colours) and the shared pieces.

## Publishing

`npx eas build --profile production --platform all`, then
`npx eas submit`. Needs an Apple Developer account and a Google Play
developer account; bundle ids are `com.mywork.app` on both.
