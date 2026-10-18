# Native Search redesign

Search now uses one scrolling FlatList for the controls, saved items and
results. The old controls occupied a fixed section above the scrolling list;
at a 320×420 viewport, the search input started at y=402, leaving results
inaccessible behind the header and bottom navigation.

The redesign separates the title from the Photo search/Upload actions, groups
the catalogue picker and labelled search field, and removes the animated
placeholder overlay. Result cards put the code above the title, with a separate
favourite target. The search input has an intrinsic minimum height and can
scroll into view when the native keyboard opens.

Screenshots use the real local API and existing catalogue data, rendered by
React Native's browser renderer; they are not physical-device screenshots:

- [Search, dark mode](search-dark.png)
- [Search, light mode](search-light.png)
- [Results at 320×420](results-small-phone.png)

Checks on 18 October 2026:

- 110 Jest tests in 25 suites passed, including search, clearing, catalogue
  selection, separate favourite/product actions, photo search and upload.
- TypeScript passed.
- Browser checks passed at 320×420, 390×844, 844×390 and 768×1024, with light
  and dark appearances. The input stayed within its field, retained focus
  across search updates, and results could be scrolled into view. Photo search
  and upload remained reachable. No browser runtime errors occurred.
- iOS and Android bundle exports are verified separately from installable builds.

A new signed mobile build still needs to be created and installed. Native
keyboard appearance and physical-device layout still require a device check.
