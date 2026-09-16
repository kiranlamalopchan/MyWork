# MyWork for Android and iOS

The native app: Expo (React Native, TypeScript, Expo Router). It talks to
the Django site through `/api/v1/` (see `apps/api` in the repo root) with a
token, and is the site, screen for screen, in a clean modern look of its
own — the hub, the notice board, stories, the inbox with push, PLU lookup and photo
search, the clock, the timesheet and its calendar, shifts, workplaces, pay,
the statement, your profile and the holidays. Nothing in it opens the
site: PLU photo search reads the photo through the API too.

## Running it on your phone

1. In the repo root, run the site so the phone can reach it on the Wi-Fi:

       python manage.py runserver 0.0.0.0:8000

2. `npm install`, then `npx expo start`. Install **Expo Go** from the App
   Store / Play Store and scan the QR code. With no `.env`, the app talks to
   the laptop Metro is running on, port 8000 — never `localhost`, which on a
   phone is the phone. To pin it, copy `.env.example` to `.env` and set
   `EXPO_PUBLIC_API_URL` (`ipconfig getifaddr en0` on a Mac for the address;
   `npx expo start --clear` after changing it).

3. The **server line under Sign in** ("192.168.0.11:8000 · Change") changes
   the address on the phone itself, without a new build — the laptop while
   developing, the live site once it has the API. It is kept on the phone.
   If the address has no API on it (an old deploy), the sign-in error says
   so instead of a bare "not found".

Push notifications need a *development build* rather than Expo Go (Expo
Go on Android has none since SDK 53 — the app detects Expo Go and skips
push there, so everything else works): `npx eas login`, then
`npx eas build --profile development --platform android` (or `ios`) and
install what it produces. `eas.json` carries the profiles; each points at
the live site, so **that site must have `apps/api` deployed** (pull,
`pip install -r requirements.txt`, `migrate`, Reload) before a store-style
build can sign in — or use the server line to point it elsewhere. Android
builds allow plain `http://` addresses (`expo-build-properties` in
`app.json`), which a LAN laptop is. A build only carries the native modules
that existed when it was made: after a new Expo package, rebuild
(`npx expo run:ios --device` / `run:android`); until then the screens that
need it explain themselves rather than blanking (`src/ui/native.ts`).

## Working on it

    npm run typecheck     # tsc
    npm test              # jest: the API client, path mapping, hue maths
    npm run web           # the same screens in a browser, for a quick look

The look is flat and modern — no gradients: a calm grey (or near-black)
ground (`src/ui/Backdrop.tsx`), solid cards with soft shadows, filled
fields, pill buttons, colour-coded icon tiles, a deep-green hero for the
next holiday and the week's pay, the app bar with the logo, the bell, your
face and the day/night switch (`src/ui/AppBar.tsx`, `DayNight.tsx`,
`AppMenu.tsx`), and the tokens in `src/ui/theme.ts`. It fits the screen it
is on: `useLayout()` (`src/ui/layout.ts`) gives every screen its gutter,
safe-area insets and screen class — tighter on a narrow Android phone
(tiles become rows, the dial shrinks, the clock buttons stack), a centred
column capped at 680pt on a tablet or a phone on its side. The phone
answers taps (`src/ui/haptics.ts`, expo-haptics on both platforms): a
tick on chips, segments and switches, a knock on buttons and a heavier one
on Clock in / out, "done" on a save or a post, a warning before anything
destructive, an error buzz on a failure. The keyboard never hides what
you type (`src/ui/keyboard.tsx`): Android draws edge to edge, so the
window no longer shrinks for the keyboard on its own — every `Screen`
pads its page by the keyboard's height on both platforms, and a box that
takes focus (a comment box at the foot of a notice, a form field) asks
its page to scroll it into the clear. A choice from a short list (the
state on Public holidays) is the phone's own control (`src/ui/Select.tsx`,
@react-native-picker/picker): Android's dropdown, iOS's wheel in a sheet,
the browser's select. While a list loads, its rows' shapes pulse in place
(`src/ui/Skeleton.tsx`: `Bone`, `SkeletonRows`) rather than a spinner —
PLU results, a photographed list being read. Anything with a file in it
(a story, a profile photo, a picking-list photo, a payslip) goes up as
XMLHttpRequest rather than fetch: it reports progress (the story composer
shows a bar), and it waits up to ten minutes for the answer — fetch on iOS
gives up after one, which a video conversion can exceed. Signing in can be the phone's own lock (`src/auth/biometric.ts`,
expo-local-authentication): after a password sign-in on a phone with Face
ID, Touch ID or a fingerprint, the app offers to keep that sign-in behind
the lock (a switch on the profile page turns it on or off); the token
stays in the keychain under its own key, signing out keeps it alive on
the server (`auth/logout/` with `keep_token`), and the sign-in screen
keeps a small button for it at the end of the password box (beside the
show/hide eye) — the lock is asked only when that is pressed. A token the server
has forgotten drops the lock and asks for the password once more.
A screen that throws shows the
error and a way back (`ErrorBoundary` in `app/_layout.tsx`). The tab bar is the phone's own
(`expo-router/unstable-native-tabs`: the system bar on iOS, Material's on
Android) with the site's five tabs — Home, PLU, Clock, Timesheet, More —
each tab a stack of its own under `app/(tabs)/<tab>/`. Every screen draws
the app bar itself (`<Screen>`), so the stacks draw no headers. The web
build keeps the JavaScript tab bar (the native one has no icons there).

TimeSheet's screens read `/api/v1/timesheet/…` (`apps/api/views/timeclock.py`),
which wraps the site's own helpers and forms, so every figure — the week's
pay, a limit bar, what a job owes — is the one the page in the browser
shows. The shared pieces (status pill, ledger, limit bar, a shift row, the
date-and-time field, the chips a `<select>` becomes) are in
`src/ui/timesheet.tsx`; the two big forms are `src/ui/ShiftForm.tsx` and
`src/ui/WorkplaceForm.tsx`.

Layout: `app/` is the routes (Expo Router — a file is a screen), `src/api`
the typed calls and react-query hooks, `src/auth` the token and session,
`src/push` registering the phone, `src/nav/paths.ts` how the site's paths
(what a notification carries) map to screens, `src/ui` the theme (the
site's own colours) and the shared pieces.

## Publishing

`npx eas build --profile production --platform all`, then
`npx eas submit`. Needs an Apple Developer account and a Google Play
developer account; bundle ids are `com.mywork.app` on both.
