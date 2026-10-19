# Catalogue three-dot actions

Edit and Delete are hidden behind a 44px three-dot control on each catalogue card. Delete retains the existing confirmation flow. Website menus reuse the site's dismissal behavior and shared menu styling; native cards use an anchored modal menu.

Verified on the website at 320px, 390px and 1280px, and in Expo's native-component browser preview at 320px and 390px. Opening, outside dismissal, Escape dismissal, editor navigation and cancelled deletion passed, with no runtime errors. No catalogue data was changed during these browser checks.

Eight native search/menu tests, 13 Django navigation/management tests and TypeScript passed. Lint has zero errors and the existing 24 warnings. Screenshots use the local account's real catalogue; native preview images are not installed phone screenshots.

Changes are local, pending deployment/app rebuild. These images supersede the visible Edit/Delete buttons in earlier catalogue previews.
