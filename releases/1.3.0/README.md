# KaamKoRecord 1.3.0

This release includes picking-slip crop/rotate, product favourites and recent items,
account-scoped form/scan recovery, offline shift drafts with idempotent sync,
optional app lock, and problem reports with optional screenshots. Local drafts
and favourites belong to this device; uninstalling the app removes them.

The home screen now reads the same festival selection, uploaded banner, greeting
and description as the website. The selected festival chooses the matching motion;
Off hides the banner and motion. Reduced Motion disables the native animation.
The home query refreshes on foregrounding or pull-to-refresh.

## Backend deployment required

The builds use https://butcher11643.pythonanywhere.com. Deploy this repository's
backend before testing or releasing the builds:

1. Back up the production database and media, then update the server checkout.
2. Install requirements in the server's virtual environment.
3. Run `python manage.py migrate --settings=mywork.settings.production` and
   `python manage.py collectstatic --settings=mywork.settings.production --noinput`.
4. Reload the PythonAnywhere web application.

The live `/api/v1/mobile/release/` endpoint returned HTTP 404 during preparation
on 17 October 2026 (Darwin time); the new production endpoints are not deployed yet.

New migrations: `api/0001_initial`, `api/0002_mobilerelease`, and
`holidays/0003_festivalthemesettings_banner`. Existing pending shift submissions
are protected by a per-account UUID receipt; retries return the existing shift.
Validation/conflict failures stay on the device for review. Automatic sync runs
while the app is open and when it returns to the foreground, not as a background
service. The app only enables offline queueing after the server advertises support.

## Administrator controls

- Festival theme settings: select a festival and optionally upload a banner.
  A selected festival supplies its motion automatically; Off hides everything.
- Support reports: read submitted descriptions, app/build/platform and attachments;
  mark resolved. The feature creates an admin record, not an email.
- Mobile releases: add version 1.3.0 (or a future release) with notification text.
  Once the version is available in both stores, select the release and run
  **Send update notification for the selected release**. Existing notification
  delivery sends to subscribed devices. Repeating the same version is deduplicated.
  No announcement has been sent as part of preparing this release.

A notification tap opens Google Play on Android and the App Store on iOS. This
routing requires the new app build; old installations cannot acquire native code
from a website deployment. Users need notification permission and a registered
push token to receive the push. This is an optional store announcement, not a
forced update or an automatic download.

## Build files

Android AAB: upload to the existing Google Play application
`com.kiranlama.merokaam`. The production iOS IPA is for Transporter/App Store Connect
and TestFlight after processing; it cannot be installed by opening it on an iPhone.
Apple app ID: 6813073450, bundle ID: com.kiranlama.mywork.

Signed artifacts are delivered in the Desktop release folder. Build identifiers,
versions and checksums are recorded with the delivery. Nothing is submitted to
Google Play or Apple automatically.

## Validation

Regression tests cover retry deduplication, conflicts, restored account-isolated
drafts, app lock cancellation/relocking, crop coordinates, store URL selection,
report ownership, festival Off, and update-announcement routing. Both native
JavaScript bundles are exported before the signed cloud build. Physical-device
checks of camera, biometric prompts, offline toggling and push delivery still
need to be performed with installed builds and the deployed backend.

## Completed store builds

- Android 1.3.0, version code 14: `KaamKoRecord-1.3.0-aab-14.aab`.
  [EAS build](https://expo.dev/accounts/lopchan/projects/mywork/builds/1a939cdf-35e8-4016-9396-a6216ab558ab).
- iOS 1.3.0, build 13: `KaamKoRecord-1.3.0-ipa-13.ipa`.
  [EAS build](https://expo.dev/accounts/lopchan/projects/mywork/builds/f9cf814a-2f1e-40f0-a44f-5c38e066c483).

Both builds completed on 17 October 2026 (Darwin time) from source commit
`3434f58f5957002686df9806862f902679c054bd`. The files are in
`~/Desktop/KaamKoRecord-1.3.0/`. The APK build was cancelled at the user's request.
`ARTIFACTS.json`, `SHA256SUMS.txt` and `VALIDATION.txt` record archive and signature
checks. Production backend deployment remains required before releasing the new
server-dependent features.
