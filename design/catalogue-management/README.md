# Search and catalogue management

Search contains item lookup, catalogue selection, result code copying and compatible photo search. It starts with a clear results area. Catalogues contains upload, editing and confirmed deletion, with no photo-search or item-search tools.

Editing changes the catalogue name and searchable columns without changing item IDs, codes or saved details. Existing search text is updated transactionally. Replace CSV opens the existing upload flow with the chosen catalogue selected. Uploading, saving edits and deleting return to Catalogues.

Verification:
- 834 Django tests and 118 native tests passed; TypeScript passed. Lint has zero errors and the existing 24 warnings. No migrations are needed.
- Browser integration exercised rename, searchable-column changes, CSV replacement preselection, deletion cancellation and confirmed deletion on web and native components. Tests used a temporary QA account; existing user catalogues were not edited or deleted. QA data was removed afterwards.
- Native browser previews fit at 320px and 390px, with no runtime errors or horizontal overflow.
- Screenshots show read-only views of the existing local account. Native images use Expo's browser renderer, not an installed phone build.
- iOS, Android and web bundle exports succeeded. No signed app build or website deployment was performed.

These screenshots supersede earlier catalogue previews in sibling folders.
