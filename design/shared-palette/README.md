# Shared 60–30–10 design

The website and native app share pale grey light-mode backgrounds and pure black dark-mode backgrounds. Light-mode cards use soft mint surfaces and dark text; dark-mode cards use charcoal surfaces and light text. Page-level actions use an emerald/mint accent. Large Profile cover areas, notification cards, chart comparisons and clock materials reuse the common roles. Pay cards retain workplace-coloured gradients, white text and gold chips. Status colours remain semantic; festival artwork, photos, avatar identity colours and user-selected workplace swatches retain their content meaning. Dark-mode page backgrounds are exactly `#000000`.

The canonical palette is `design/tokens/palette.json`; `scripts/sync_palette.py` generates both the native token module and web stylesheet. Browser chrome reads the current CSS background, and administration pages reuse the same variables. A generator check guards against platform drift and native contrast tests enforce at least 4.5:1 for normal text/action labels.

Validation of the initial shared-palette revision (before the mint light-background update): all 185 native tests, 871 backend tests and nine JavaScript tests passed. TypeScript passed; lint has zero errors and the 24 existing warnings. iOS and Android bundle exports succeeded. Automated browser checks covered 12 page families in both themes, anonymous login, saved light preferences over a dark system, automatic dark appearance, theme toggling, 320 px and desktop widths, and administration backgrounds. No browser runtime errors or horizontal overflow were found.

Screenshots show the real website with an isolated preview account/database. Native components were tested and bundled; no installed phone build was tested. Nothing was deployed.

The light-mode background is `#eaeaf0`, slightly deeper than the supplied iPhone Settings screenshot. The temporary mint-in-dark-mode card styling was reverted at the user’s request; see `../restored-dark-cards/README.md`.
