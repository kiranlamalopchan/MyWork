# Work reveals and swipeable option rows

Clock and Timesheets reveal from the left; Pay and Settings reveal from the right. The destination determines the direction, including when returning to an already-mounted Work screen. Native Work routes use the shared reveal instead of adding a second stack animation; web Work navigation uses matching arrival directions.

Holiday regions, segmented tabs, workplace filters and other single-choice chip groups use a shared horizontal choice rail. The selected option stays in view, all choices remain on one line, and users can swipe in either direction. Reduced-motion settings disable reveals and smooth auto-scrolling.

Evidence:
- `work-reveals.gif` contains real native-component browser frames from Clock → Pay → Clock → Settings → Timesheets. The demo uses an empty temporary QA account, not the user's financial data.
- `holiday-region-rail.png` shows the holiday card after a real horizontal touch gesture, cropped to exclude profile fields.
- Browser checks at 320px and 390px verified reveal direction, return navigation, final alignment, a single-row region picker and horizontal touch scrolling with no runtime errors. Reduced-motion browser checks kept content still. Website checks verified all four reveal directions.
- All 123 native tests, nine JavaScript tests and TypeScript passed. Navigation checks passed; lint has zero errors and the existing 24 warnings.
- iOS, Android and web bundle exports succeeded. No signed mobile build or deployment was performed. Native previews use Expo's browser renderer; physical-device checks were unavailable.

The temporary QA account and test sessions were removed. Changes remain local, pending deployment/app rebuild.
