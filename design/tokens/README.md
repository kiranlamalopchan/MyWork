# Shared 60–30–10 palette

`palette.json` defines the website and native app's colour roles. The dominant role (about 60% of the visual composition) is the page background; supporting surfaces (about 30%) distinguish cards and controls; the remaining accent (about 10%) marks actions, links, focus and selections. These are composition guidelines, rather than fixed pixel quotas on content-heavy pages.

Light mode uses a pale grey background (`#eaeaf0`), slightly deeper than the supplied iPhone Settings screenshot, soft mint cards (`#e0f0e6`), gently green-tinted controls and deep emerald actions. Dark mode uses a pure `#000000` page background, charcoal surfaces and mint actions. Red and amber communicate errors and warnings. Pay cards retain workplace-coloured gradients, white text and gold chips. Avatars, user-selected identification swatches, photos and festival illustrations retain meaningful content colours.

Web and mobile use the same light background; no mobile white-background override is applied.

Run `venv/bin/python scripts/sync_palette.py` after editing the source. This generates `static/css/palette.css` and `mobile/src/ui/palette.ts`. Run the same command with `--check` to detect drift; the backend suite checks the generated files too. Native contrast tests enforce at least 4.5:1 for normal text and action labels on the main surfaces.

Load the generated web palette before the theme script and component styles. Browser chrome reads the active background from CSS, and Django administration maps its own variable names to the same roles. Keep large decorative areas pale and reserve the saturated accent for small, useful emphasis.

