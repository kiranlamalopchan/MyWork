# Five search results per page

Web and native item search now show at most five results on each page. Previous/Next replaces the displayed rows instead of appending more while scrolling. Changing the query or catalogue starts at page one. Each result shows only its item number and description (falling back to the title for catalogues without a description); copy, favourite and detail actions were removed from search results.

The shared backend page size limits the database query to five matches on the web and mobile API. Active searches no longer include unused sample items in their response.

`web-five-results.png` and `native-five-results.png` show the actual applications using eleven products from the repository's sample CSV in an isolated temporary account. The native screenshot uses Expo's browser renderer, not an iOS or Android simulator. Automated browser checks verified pages of 5/5/1, replacement of rows, Previous navigation, no automatic next-page request, query reset, clearing, and layout at 320px. The temporary account, catalogue, token and session were removed.

Validation: 57 scoped backend tests, all 131 native tests, nine JavaScript tests and TypeScript passed. Final search-specific native checks passed after layout adjustments. Lint has zero errors and the existing 24 warnings. Django checks and JavaScript syntax checks passed. iOS, Android and web bundle export succeeded.

Changes remain local; deployment and an updated mobile build are required for the installed app.
