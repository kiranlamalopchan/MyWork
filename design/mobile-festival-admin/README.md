# Admin festival banner control

Authorised admins open **Profile → Settings → Festival banner** in the native app. They can choose a festival, preview its banner, customise the greeting/description and image, restore standard artwork, select Automatic, or turn the banner Off. Only **Save banner** changes the shared configuration.

The API independently requires an active staff account with `holidays.change_festivalthemesettings`, matching the website's existing festival-management permission. Ordinary accounts do not see the entry, cannot load the editor through its direct route, and cannot read or change settings through the endpoint. The choice is shared by web and mobile Home.

Screenshots use Expo's browser renderer and a real local API with temporary admin/reader accounts. `admin-editor-390.png` shows the editor, `admin-preview-390.png` shows its unsaved Tihar preview and Save action, and `reader-access-denied-390.png` shows direct-route protection. Phone widths of 320 and 390 pixels passed the overflow checks. Browser preview requests never saved or changed the real shared banner.

Backend tests cover permissions, self-escalation attempts, preview reads, shared Home output, Automatic/Off, validation, image uploads/removal, and permission revocation. Native tests cover direct-route protection, preview-only edits, explicit saving, cache refresh, error handling, and multipart empty-text preservation.

All 845 backend tests and 131 native tests passed. TypeScript and Django checks passed; lint has zero errors and the existing 24 warnings. iOS, Android and web bundle exports succeeded. Temporary preview accounts and tokens were removed, and the shared banner was verified unchanged.

Changes are local. Expo bundle export is not a signed phone installation or deployment.
