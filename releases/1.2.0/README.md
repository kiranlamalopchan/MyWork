# KaamKoRecord 1.2.0 — store upload package

- [Google Play release notes](google-play-release-notes.txt): paste into the
  English release-notes field.
- [App Store What's New](app-store-whats-new.txt): paste into What's New in
  This Version for the 1.2.0 update.
- [Feature details](FEATURES.md): a longer explanation of the changes.
- [Build metadata](builds.json) records the status, identifiers, build
  numbers and artifact URLs returned by EAS.
- Downloaded binaries are in `artifacts/`. `ARTIFACTS.json` records their
  archive checks and sizes; `SHA256SUMS.txt` records their file checksums.

## Store binaries

- Android: **1.2.0, version code 9** —
  [AAB file](artifacts/KaamKoRecord-1.2.0-android-9.aab),
  [EAS build](https://expo.dev/accounts/lopchan/projects/mywork/builds/3fa95efa-9ce0-4ffd-9ec5-14b2856192e2).
- iOS: **1.2.0, build 10** —
  [IPA file](artifacts/KaamKoRecord-1.2.0-ios-10.ipa),
  [EAS build](https://expo.dev/accounts/lopchan/projects/mywork/builds/0eb002b2-897a-48b6-a4d8-4e4a7e71329d).

Both EAS production builds completed successfully on 9 October 2026. The
local binaries are downloaded, their ZIP integrity checks passed and their
checksums are recorded. The iOS embedded version, build number and bundle
identifier match this release. Both archives contain signing files.

## Required backend update

The builds point at `https://butcher11643.pythonanywhere.com`.
On 9 October 2026, the live `/api/v1/items/search/` endpoint returned 404.
Deploy this checkout's backend before testing or publishing the catalogue
features. Follow the production deployment instructions in the root README:
update the server checkout, install requirements, apply migrations, run
collectstatic and reload the PythonAnywhere web app.

The new catalogue migrations are
`apps/plu/migrations/0003_catalogueupload_pluitem_code_pluitem_fields_and_more.py`
and `0004_catalogueupload_filename_alter_catalogue_owner_and_more.py`.
Existing shared PLU data is preserved by the migration; see the root README
for assigning legacy data to the intended account.

## Google Play Console

1. Open the existing app with package `com.kiranlama.merokaam`.
2. Create an internal-testing release and upload the new Android `.aab`.
3. Use `1.2.0` as the release name and paste the Google Play release notes.
4. Test the installed release against the updated backend, then prepare
   the production rollout in Play Console.

Google Play allows up to 500 Unicode characters per language in release
notes. This package's English notes stay within that limit.
See [Google's release instructions](https://support.google.com/googleplay/android-developer/answer/9859348?hl=en).

## App Store Connect

1. Upload the new `.ipa` using Apple's Transporter app on this Mac.
2. Wait for Apple to process the build in the existing App Store Connect
   app (Apple ID `6813073450`, bundle ID `com.kiranlama.mywork`).
3. Test it through TestFlight, including iPhone and iPad layouts.
4. Create the `1.2.0` version, select the new build and paste the What's New
   text. Provide a working reviewer account in App Review Information.
5. Complete the version's required metadata and submit for review when ready.

See [Apple's build upload instructions](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
and [Transporter guidance](https://support.apple.com/en-gb/guide/transporter-app/apdac1c9a477/mac).
EAS Submit is another upload option; [Expo explains submission separately
from store release](https://docs.expo.dev/deploy/submit-to-app-stores/).

## Test before release

- Sign in, upload a CSV with custom headings and save a named catalogue.
- Save a second catalogue and switch between them when searching.
- Confirm a different account cannot access those catalogues.
- Confirm clock, breaks, timesheets, pay and configured hour limits work.
- Change appearance in Profile, restart the app and check it is remembered.
- Tap an app push notification while the app is open, in the background
  and fully closed. Repeat on Android and iOS; check the destination and
  unread badge. A browser-origin notification is a separate web flow.

These builds are prepared for upload. They are not automatically submitted
to either store or published to users.
