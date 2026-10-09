# KaamKoRecord 1.2.0 — feature details

## Flexible item search

Item search now supports each user's own CSV structure. During import, the
user chooses the title, optional description and code headings, and the
columns that can be searched. A butcher can use PLU codes while another
user can search groceries or another list using the headings in their file.

## Private, named catalogues

Each CSV upload is saved in the database as a named catalogue belonging to
the signed-in user. For example, Meat and Groceries are separate catalogues.
Users choose which catalogue to search. Replacing a selected catalogue
updates that list while keeping their other catalogues. Search and item
details enforce catalogue ownership.

## Clearer navigation and design

The app has five main destinations: Home, Items, Work, Alerts and Profile.
Android and iOS use native tab navigation and native stacks. Work groups
Clock, Timesheets, Pay and Settings. The clock has a realistic analog face
with moving hands, while worked-time and break timers remain visible.

Home's repeated item-search and timesheet shortcut cards have been removed.
Stories, the notice board and daily content remain available. Common web
navigation, theme behavior and credential-field markup are shared to reduce
duplication and make later changes consistent.

## Notifications

Alerts is now a main tab with an unread badge. A tap on an app push
notification is handled inside the mobile app, including a cold start.
After authentication and navigation are ready, the app resolves the
notification to its screen and refreshes unread counts. If the destination
is unavailable or cannot be resolved, the app opens Alerts. Browser push
notifications continue to open the website.

## Profile appearance settings

Dark/light mode is in Profile settings and is remembered on the device.
The mobile control uses the phone's native switch. Profile still provides
account details, security controls, sign out and the existing account tools.

## Existing work tools

Clock in/out, breaks, shifts, timesheets, workplaces, pay, statements and
hour restrictions remain available. This release reorganizes their access
and presentation.

## Release validation

The pre-build checks passed: 82 mobile tests, TypeScript type checking, and
4 backend version tests. The preceding design/navigation validation passed
771 backend tests and Android/iOS/web exports. The phone-sized website
preview confirmed the five-tab layout, Profile's theme switch, saved theme
across navigation and the Alerts inbox. Physical-device push testing still
needs to be completed using these store builds.

Both EAS production builds finished successfully on 9 October 2026:
Android 1.2.0 (version code 9) and iOS 1.2.0 (build 10). Both binaries were
downloaded and passed archive integrity checks; their SHA-256 checksums are
saved alongside this document. The iOS embedded version and bundle ID were
also checked against the release metadata.
