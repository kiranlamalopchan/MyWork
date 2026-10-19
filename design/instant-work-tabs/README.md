# Immediate Work tab switching

Clock, Timesheets, Pay and Settings no longer run entrance slides or fades in native UI or on the website. Native stack transitions remain disabled. The Work segmented control reveals off-screen choices immediately, without smooth auto-scrolling. On the website the Work tab capsule and press/icon transitions are also disabled. Interactive controls such as the Pay workplace carousel retain their own behaviour.

All 137 native tests and TypeScript passed. Six web navigation tests and nine JavaScript tests passed. Lint has zero errors and the existing 24 warnings. iOS, Android and web bundle export succeeded.

Browser checks switched Pay → Clock → Settings → Timesheets → Pay using a temporary empty account. Web checks confirmed no container animation/transform, full opacity and no Work tab-slider element. Native checks confirmed the removed Work reveal wrapper and working route changes. Native preview uses Expo's browser renderer. No signed mobile installation or deployment was performed.
