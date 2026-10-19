# Fixed Search / My catalogues header

Both native tabs now share one mounted Screen and header, including the brand, toggle, heading styles, description space and body starting position. The header stays above the scrolling content. Only the body changes when switching, without a stack transition. Switching also dismisses the keyboard. The Catalogues-only brand badge was removed.

Automated checks against the actual Expo components and local API verified identical header, toggle, title and content starting coordinates before and after switching at 320px and 390px. The same header node stays mounted. It stays still while scrolling either tab, paging search results and returning to the other tab. Screenshots `search.png` and `catalogues.png` show the matching positions. Native screenshots use Expo's browser renderer.

All 131 native tests and TypeScript passed. Lint has zero errors and the existing 24 warnings. Temporary QA accounts, catalogues and tokens were removed. Changes remain local, pending an updated mobile build.
