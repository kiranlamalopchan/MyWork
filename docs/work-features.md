# Work features and phone testing

These features use Expo SDK 58, alongside the profile photo fix, revised light
palette and five-person discovery list.

## Available in the app

- **Shift reminders:** Work → Roster → Add a shift. The phone schedules a local
  notification before each shift; choose the lead time under Profile → Settings → Notifications.
  A running rostered shift also gets a reminder 15 minutes after its planned end.
  Changes to the roster replace its alarms; signing out removes them.
- **Widget and lock screen:** Add **Work clock** from the phone's widget gallery.
  It shows the last synchronized shift or next rostered shift and opens the clock.
  On iOS, a running shift also creates a Live Activity with an elapsed work/break
  timer. Both platforms have a standing notification with break/clock-out actions.
  The lock-screen setting turns the Live Activity and standing notification off.
  **Widget actions open the app's clock; background clock-in/out is not implemented.**
- **Pay-period summary:** The existing `timesheet_reminders` command now includes
  hours, estimated pay and a comparison with the preceding period. It sends after
  8 am in the account's saved time zone on the morning after the period closes,
  avoiding an incomplete summary before the final day's shifts finish.
- **Payslip check:** Work → Work settings → Check a payslip. Select the job when
  needed, then choose a PDF or image. Its hours and gross pay are compared with
  completed shifts in that period. The uploaded payslip is not retained.
- **Roster and cover:** Add, edit or remove upcoming shifts; offer one to friends
  or take a friend's offered shift. Taking it transfers ownership and notifies
  the previous owner. Blocking prevents sharing between those accounts.
- **Messages:** Alerts → Messages, or Message on a friend's profile. Friends can
  exchange text, read earlier messages and see unread counts. Blocking hides the
  conversation; ending the friendship keeps history but prevents further sends.
  Failed sends keep their draft. An offscreen conversation stops polling.
- **Nepali:** Profile → Settings → Appearance → Language → नेपाली. The saved choice applies
  immediately to the main navigation, clock, roster, messaging and new settings.
  Pages without translations and server-written text remain in English, as
  stated beside the language setting.

## Prepare the backend

```sh
python manage.py migrate
python manage.py collectstatic --noinput
```

Reload Django after updating the code. Run the existing scheduled command
regularly (for example every 20 minutes) to deliver forgotten-clock-out, hours-cap
and pay-period notifications even when nobody opens the app:

```sh
python manage.py timesheet_reminders --quiet --settings=mywork.settings.production
```

## Test on a phone before release

From `mobile/`, run `npm ci`, then `npm start` for the ordinary app screens.
An existing SDK 54 development build cannot load SDK 58 JavaScript.

The home-screen widgets and iOS Live Activity require a **new development build**;
they are unavailable in Expo Go. Android notification actions also need a build.
For a locally connected device with the platform toolchain installed:

```sh
npm run ios -- --device
# or
npm run android -- --device
```

Alternatively use the existing EAS `development` profile for a registered device.
No store release is needed for this testing.

Check permission denial, starting/ending a break, clocking out, edited/removed
roster alarms, taking cover without an existing workplace, language changes,
failed message sends, blocking, sign-out, and both light/dark appearances.

Widgets refresh when this app synchronizes; changes made on another device do
not remotely update a suspended widget or Live Activity. Native compilation and
physical-device behavior must still be verified before a store release.
