# PLU search usability redesign

Search appears before the catalogue chooser. A static hint, a visible submit button and 44px or larger action targets make the main controls easy to find. Starter items replace the idle empty card, and each code can be copied without opening its details. Photo search, uploads and catalogue navigation remain available. Native favourites and recent items retain their existing account scope.

Screenshots show real local catalogue data. `native-phone-preview.png` uses Expo's browser renderer; it is not a screenshot of an installed phone build.

Validation:
- Website: 320px, 390px in dark and light mode, 844px landscape and 1280px; search, clear, pagination, copy-to-clipboard, catalogue navigation, photo search and upload navigation passed with no runtime errors or horizontal overflow.
- Native browser preview: 320px, 390px and 768px; search, clear, code copy and photo navigation passed.
- Website search also passed with JavaScript disabled.
- 88 Django PLU tests, 112 native tests and nine JavaScript tests passed. TypeScript passed; lint has zero errors and the existing 24 warnings.
- Expo exported iOS, Android and web bundles successfully. No signed mobile build or deployment was performed.

Changes remain local.
