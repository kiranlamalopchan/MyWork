> Historical preview: this mint-in-dark-mode styling was reverted at the user’s request. Current dark-mode cards are charcoal with light text.

# Mint cards in both appearances

Regular website and native cards use the same soft green surface (`#e0f0e6`) in light and dark mode. Their content uses dark text and emerald actions for contrast. Dark-mode pages and navigation remain black/charcoal. Workplace Pay-card gradients, gold chips and white amounts are preserved.

Web card containers scope the generated light palette locally. Native Card supplies a local palette to child controls; explicit parent-rendered styles use onCard(theme). The saved appearance preference remains unchanged, including the Dark mode switch inside a green card. Search results and wide Work settings tiles use the same card palette.

Validation: all 194 native tests, TypeScript, three backend Pay/palette checks and nine JavaScript tests passed. Lint has zero errors and the existing 24 warnings. iOS and Android bundles exported successfully. Automated Chrome checked 11 page families in both modes, real catalogue results, black dark-page backgrounds, mint card scopes and preserved workplace Pay gradients; additional checks at 320 and 1280 px found no overflow. No browser runtime errors were recorded.

Screenshots show the actual website using an isolated preview database, which was removed afterwards. Native code was tested and bundled; no installed phone build was tested or deployed.
