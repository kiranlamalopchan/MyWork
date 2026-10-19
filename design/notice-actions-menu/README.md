# Notice overflow actions

Full notice cards on web and mobile now keep Edit, Delete and Pin/Unpin inside a single three-dot menu by the author. The conversation row keeps React and Comment, plus Report on other authors' posts. Edit/Delete remain owner-only; Pin/Unpin retain the server's existing admin and visibility rules. Delete keeps its confirmation.

The native card reuses the shared accessible overflow menu. Its position is clamped inside the viewport, including during size changes. Menus support outside dismissal and Escape, and Edit still opens the inline editor.

Screenshots show the actual website and Expo native components against a separate, isolated preview database. Automated browser checks exercised inline editing, Pin/Unpin, cancelled deletion, permission-filtered menus, Escape/outside dismissal and 320px layout. No real public notice was created or changed. A short-lived private preview post/account in the normal development database was removed before the isolated run.

Validation: all 236 notice/API backend tests, all 133 native tests and TypeScript passed. Lint has zero errors and the existing 24 warnings. Changes remain local, pending deployment and an updated mobile build.
