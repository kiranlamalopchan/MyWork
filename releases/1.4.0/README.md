# KaamKoRecord 1.4.0

Password recovery by email, a redesigned Profile, friends on Home, smooth
folds throughout, and pay worked out with the ATO's 2026–27 withholding
formulas.

## What's new (store text)

Paste into App Store Connect ("What's New in This Version") and Google Play
("Release notes"). Short enough for both stores.

- Reset your password by email
- New Profile design
- See your friends on Home
- Smoother animations
- Pay follows the ATO's 2026–27 tax rules
- Bug fixes and improvements

## Promotional text (App Store)

Up to 170 characters; can be changed at any time without a new review.

> New: reset a forgotten password by email, a fresh Profile, and your friends
> right on Home. Track shifts, pay and tax — all in one place.

Alternatives:

> Clock in, track every shift and see your pay worked out the ATO's way. Now
> with password reset by email and a brand-new Profile.

> Your shifts, pay and work friends in one app. Forgot your password? Now you
> can reset it by email in seconds.

## Short description (Google Play)

Up to 80 characters.

> Track shifts, pay and tax, and stay in touch with your work friends.

## Changes in detail

**App and website**

- **Password recovery.** "Forgot password?" on sign-in (site and app) emails a
  one-use link that expires after an hour, sent through Brevo's HTTPS API.
  Changing the password signs out other browsers and app tokens. Accounts
  with no email can still be given a link by an admin. Setup and
  troubleshooting: `docs/password-recovery.md`.
- **Profile.** Floating cover with the photo over its edge, then name, handle
  and three figures — posts, friends, shifts — each a way in. Open sections
  sit on an inset of their own; Activity's counts are a grid of tiles.
- **Friends on Home.** Up to six overlapping faces above the notice board,
  display-only, hidden with no friends. Live dot matches the site's.
- **Folds.** Every collapsible on the site and in the app opens and shuts with
  one motion (380 ms open, 300 ms shut, iOS-like curve). Reduced Motion
  opens them instantly.
- **Pay.** ATO 2026–27 withholding; the earnings chart now lives on
  Timesheets only. Fixed: typing the last day of a fortnight into "Paid up
  to" now settles everything up to that day, not just that fortnight.
- **Board.** Admins can pin notices; notifications are deleted at 30 days.
- **Look.** Home cards flat (no gradients or glows); dark mode is pure black.

**Website only**

- Show/hide eye on every password box (the app already had one).
- Input boxes have a visible rim, so they no longer vanish on mint cards.
- Responsive desktop and iPad layout, footer with store QR codes.
- Updated Privacy Policy (effective 19 October 2026) and Community rules.
- Deleting an account now also removes story files and support screenshots.

## Backend deployment required

The builds use https://butcher11643.pythonanywhere.com, and password reset
needs the new server code. Before either store releases 1.4.0:

1. Pull on PythonAnywhere (`~/MyWork`), then
   `pip install -r requirements.txt`.
2. Make sure `.env` has `BREVO_API_KEY`, `DEFAULT_FROM_EMAIL`,
   `PASSWORD_RESET_BASE_URL` and `CONTACT_EMAIL`, then run
   `python manage.py check_password_recovery`.
3. `python manage.py migrate` and
   `python manage.py collectstatic --noinput` (production settings).
4. Reload on the Web tab, then test "Forgot password?" once.

Brevo was checked on 20 October 2026: key valid (free plan, 300 emails/day),
Gmail sender verified, and a test email was delivered and opened.

## Builds

Built on EAS on 20 October 2026 from commit `4a7449b` plus the uncommitted
working tree (version bump and the changes above).

- **iOS 1.4.0, build 14** —
  [EAS build](https://expo.dev/accounts/lopchan/projects/mywork/builds/20e8f038-e627-43dc-bd33-eb6e24a65426).
- **Android 1.4.0, version code 15** —
  [EAS build](https://expo.dev/accounts/lopchan/projects/mywork/builds/681c3a55-52d8-444a-b665-371a93004f5c).
  File: `~/Desktop/KaamKoRecord-1.4.0/KaamKoRecord-1.4.0-aab-15.aab`
  (SHA-256 `ae817682cf7d1921706dc6bfcbc182c1ad78ef82736c3d88bbc44ceb89686bca`).

Checks before building: 895 Django tests, 194 app tests and `tsc` all passed.

## Store upload status

- **iOS:** uploaded to App Store Connect on 20 October 2026
  ([submission](https://expo.dev/accounts/lopchan/projects/mywork/submissions/faa0f633-3c09-4b38-998c-840655e50a4f)).
  Still to do by hand: create version 1.4.0, pick build 14, add the notes,
  submit for review.
- **Android:** not uploaded — EAS has no Google Play service-account key.
  Upload the AAB in Play Console → Production → Create new release.

After both stores have it live, the admin's **Mobile releases** can announce
1.4.0 to installed apps.
