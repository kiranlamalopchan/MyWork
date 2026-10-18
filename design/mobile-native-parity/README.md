# Mobile design alignment

Updated the React Native app to follow the website's current visual design:

- Shared light/dark colours, flat card borders, corner radii and readable column widths.
- Home festival greeting over the artwork, native Dashain kites and swing, and description below.
- Read-only Home notice previews, two-notice disclosures, author-coloured notice surfaces and own-post rails.
- Visible native React, Comment, Edit/Remove or Report, and permitted Pin actions; inline commenting stays available on the board.
- Website headings and flat surfaces in Items; author-coloured unread alerts.

These screenshots show the app's actual React Native components rendered in
Chrome at a 390-pixel phone width, using the existing local Django API and data.
They are browser previews, not screenshots from an installed iOS or Android app.

- [Home, dark mode](home-dark.png)
- [Notice board, dark mode](notice-board-dark.png)
- [Notice board, light mode](notice-board-light.png)
- [Items, dark mode](items-dark.png)

Validation on 18 October 2026:

- TypeScript: passed.
- Jest: 24 suites, 107 tests passed.
- Expo export: iOS and Android Hermes bundles, plus the web bundle, passed.
- Browser-rendered checks at 320, 390 and 768 pixels: Home previews open the
  conversation, reaction picker opens, editing opens/cancels, and Comment
  focuses the inline input. Light and dark modes passed. Items, catalogues,
  Work settings, Profile and alerts were also checked at these widths.
- No horizontal page overflow or browser runtime errors during these checks.
- Existing native-navigation regression tests verify iOS/Android use the native tab navigator.

The bundle exports are in `/tmp/mywork-native-parity-bundles`. They are not
signed installable APK/AAB/IPA files. A new signed build must still be created
and installed to update a phone. Physical-device visual/keyboard testing remains
to be performed; no simulator was available in this environment.
