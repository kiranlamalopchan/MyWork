# Shared website components

The DRY refactor consolidates:

- Validated return destinations in `mywork/http.py`.
- Relative timestamps in `mywork/formatting.py`.
- Notification display names in `apps/accounts/avatars.py`.
- Report targets and acknowledgement text in `apps/moderation/services.py`.
- Thread folding and visible-comment counts in `apps/noticeboard/presentation.py`.
- Current-fortnight descriptions in `apps/timeclock/models.py`.
- Labelled fields and validation slots in `templates/_form_field.html`.
- Authentication framing in `templates/registration/base.html`.
- Repeated standard icons in the existing `ui` tag registry.
- Idle Search positioning in the original Search CSS section, removing the
  later conflicting override.

The pay-period test fixture now asks the workplace for its period instead of
repeating an outdated Monday assumption. The two failing tests were reproduced
against the original source before this fixture was corrected.

Validation on 18 October 2026:

- All 827 Django tests and 9 JavaScript tests passed.
- 36 website pages passed 108 browser checks at 320, 390 and 1280 pixels.
  No checked page had duplicate DOM IDs, horizontal overflow or JavaScript errors.
- Django system checks passed; no database migrations are needed.

Screenshots show the real local website and existing data:

- [Shared authentication frame](sign-in.png)
- [Workplace form using shared fields](workplace-form.png)

The changes have not been deployed to the live website.
