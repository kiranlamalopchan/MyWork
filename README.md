# MyWork (Django)

MyWork is the mother project. It hosts two independent apps, and signing in
lands you on a hub where you pick one; from there the navigation belongs
entirely to that app.

**PLU Management** (`apps.plu`, mounted at `/plu/`)
- Search PLUs by number or description (live, as you type)
- View PLU details and copy the code for the scale
- Read a picking-list photo and match each line to a PLU
- Import PLUs from a CSV file (staff only)
- Manage PLUs in Django Admin

**TimeSheet Management** (`apps.timeclock`, mounted at `/timesheet/`)
- Clock in and out, with breaks
- Review shifts as a list or a month calendar, and edit them
- Save workplaces and pick which one a shift belongs to
- Set a weekly or fortnightly hours limit and track against it

**Notifications** (`apps.notifications`, mounted at `/notifications/`)
- A bell in the app bar with a count, and the inbox behind it
- Web Push, so a notification arrives with the app closed
- Raised by the board (new notice, comment, reply, reaction) and by
  TimeSheet (a forgotten clock-out, an hours cap coming up)

Adding a third app means starting it inside `apps/`, mounting it under its
own prefix in `mywork/urls.py`, and giving it an entry in
`mywork/context_processors.py` plus a card on the hub. To have it notify
people, give it a `notify.py` and call `apps.notifications.notify.notify()` —
see [Notifications](#notifications).

## Deploying (PythonAnywhere)

The server runs its own WSGI file, kept in the **Web** tab under *WSGI
configuration file* — `/var/www/<user>_pythonanywhere_com_wsgi.py`. It is not
in this repository, so pulling never updates it. It must name a settings
*module*, not the settings package:

```python
import os, sys

path = '/home/<user>/MyWork'
if path not in sys.path:
    sys.path.insert(0, path)

os.environ['DJANGO_SETTINGS_MODULE'] = 'mywork.settings.production'
os.environ['DJANGO_SECRET_KEY']      = '<a long random string>'
os.environ['DJANGO_ALLOWED_HOSTS']   = '<user>.pythonanywhere.com'

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
```

A new secret key:

```bash
python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"
```

Then, in a Bash console on the server, from `~/MyWork`:

```bash
git pull
python manage.py migrate           --settings=mywork.settings.production
python manage.py collectstatic     --settings=mywork.settings.production --noinput
```

Both are required, and each fails loudly in its own way if skipped:

- no `migrate` → `OperationalError: no such table: noticeboard_notice`
- no `collectstatic` → `ValueError: Missing staticfiles manifest entry` on
  every page, because production serves static files under hashed names and
  the manifest that maps them is written by `collectstatic`.

### Profile photos

Django serves uploaded files itself only while `DEBUG` is on, so on the server
the web server has to. In the **Web** tab, under *Static files*, add:

| URL | Directory |
| --- | --- |
| `/media/avatars/` | `/home/<user>/MyWork/media/avatars` |

Without it every profile photo 404s and each face falls back to its initial.

Map `/media/avatars/` rather than `/media/`: the mapping serves whatever is
under it straight off the disk, with no view and no permission check in the
way, so it should reach exactly the files that are meant to be public.

Finally **Reload** the web app — Django will not pick up new code or a changed
WSGI file until you do.

To see the site immediately without setting any of this up,
`mywork.settings.local` will serve it — but it runs with `DEBUG = True`, which
shows a full traceback and your settings to anybody who triggers an error. It
is for a laptop, not for a site with an address.

## Notifications

The bell, the inbox and the count on them are plain Django and need no setup:
every event is recorded whether or not anything can be delivered. What needs
setting up is the *push* half — the part that reaches a phone with the app
closed.

### Keys

Web Push identifies this site to every browser's push service with a keypair
(VAPID). Generate one, once:

```bash
python manage.py vapid_keys
```

and put the three lines it prints in `.env` beside the code — the same file
`production.py` already reads its secret key from:

```
VAPID_PRIVATE_KEY=...
VAPID_PUBLIC_KEY=...
VAPID_CONTACT_EMAIL=you@example.com
```

Then **Reload** the web app. With no keys set, MyWork runs exactly as before
and simply never interrupts anyone — the inbox says so rather than offering a
switch that cannot work.

The pair is not rotated casually: a browser subscribes to a specific public
key, so replacing it invalidates every subscription already granted and
everybody has to turn notifications back on.

### Turning it on, as a user

Open the bell, then **Turn on**, and accept the browser's prompt. The prompt
has to come from that tap — asking on page load is how a browser learns to
refuse on your behalf permanently.

**On an iPhone this only works from the Home Screen.** Safari in a tab cannot
subscribe at all; iOS 16.4 or newer, opened from an icon added with *Share ->
Add to Home Screen*, can. The inbox says this instead of showing a dead
button.

### Reminders

The two TimeSheet reminders are the only things not raised by the request that
caused them — nothing happening is the thing worth saying — so they need
something periodic to notice. **This needs no setup: it already runs.**

`ReminderSweepMiddleware` runs them off the back of ordinary page loads. Every
request asks one indexed question — "has this run in the last fifteen
minutes?" — and the rare one that finds it has not runs the sweep. The claim
is a single conditional UPDATE, so several workers answering requests at the
same moment cannot both start it.

This is deliberate rather than clever, and it is because of the host. A free
PythonAnywhere account gets **one scheduled task, once a day**. A clock-out
forgotten at four in the afternoon would go unmentioned until that task ran
in the evening, which is late enough to be an accusation rather than a
reminder. Riding on traffic instead means a reminder within about fifteen
minutes for as long as anybody is using MyWork.

What it cannot do is fire at three in the morning with nobody around. So point
the one daily task at the same work as a backstop — **Tasks** tab, at a time
that suits:

```bash
cd ~/MyWork && python manage.py timesheet_reminders --quiet --settings=mywork.settings.production
```

On a paid account the same task can run hourly, and on any account running it
by hand is harmless: every reminder is keyed to the shift or the pay period it
is about, so a second run rewrites the line it already sent rather than
sending another one, and a phone is only buzzed again about the same forgotten
clock-out after three hours.

### If nothing arrives

In order of how often it is the answer:

1. **No keys, or the site was not reloaded** after adding them.
2. **The iPhone is in Safari rather than on the Home Screen** — see above.
3. **The subscription is stale.** Django Admin -> Push subscriptions shows
   whether that person has a row at all. Opening any page re-registers it, so
   "load the site once, then try again" resolves most of these.
4. **They are using Firefox.** See below.

### Free accounts and the allowlist

A free PythonAnywhere account can only make outbound HTTPS requests to hosts
on [its allowlist](https://www.pythonanywhere.com/whitelist/), which matters
here because sending a push *is* an outbound request. Two wildcard entries
cover the services that matter:

| Browser | Push service | Free account |
| --- | --- | --- |
| Chrome, Edge, Android | `fcm.googleapis.com` | yes, via `.googleapis.com` |
| Safari, iPhone | `web.push.apple.com` | yes, via `.apple.com` |
| Firefox | `updates.push.services.mozilla.com` | **no** |

So push works on a free account for every browser but Firefox, where the bell
and the inbox still work and nothing reaches the lock screen. PythonAnywhere
take requests to add hosts if that becomes worth doing.

To confirm it on your own account, from a Bash console on the server:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://fcm.googleapis.com/fcm/send/test
```

Any status code back — 400 and 404 included — means outbound works.

Notifications are recorded either way, so the bell is always right even when
the push is not arriving. That is the point of keeping the two apart.

## Layout

```
mywork/              the project: settings, root URLs, hub views
  settings/
    base.py          everything true in every environment
    local.py         a laptop — the default in manage.py
    production.py    a server — secrets and hosts come from the environment
apps/                the four applications written for this project
  accounts/          who you are: profile, avatar, contact details
  plu/               PLU lookup
  timeclock/         clocking, timesheets, pay
  noticeboard/       the board both apps share
  notifications/     the bell: one mailbox, and Web Push to carry it
templates/           every template, one directory, base.html at its root
static/              css, js, icons, the web manifest
```

Two things about `apps/` are worth knowing before changing anything in it.
Each app's `name` is its import path (`apps.timeclock`) while its `label` is
what the database knows it by (`timeclock`) — the label is set explicitly in
every `apps.py` because migrations already applied are recorded against it and
string references like `"accounts.Profile"` resolve through it. And templates
are addressed by the path under `templates/`, not by the app's module path, so
`timeclock/shifts.html` did not move when `timeclock` did.

## Settings

`DJANGO_SETTINGS_MODULE` chooses; nothing imports one settings module from
another except `local` and `production` importing `base`.

```bash
python manage.py runserver                      # mywork.settings.local, the default

DJANGO_SETTINGS_MODULE=mywork.settings.production \
DJANGO_SECRET_KEY=... DJANGO_ALLOWED_HOSTS=example.com \
  python manage.py check --deploy
```

`production` reads `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` from the
environment and raises on start-up if either is missing, rather than falling
back to something that would appear to work. Set `POSTGRES_DB` (with
`POSTGRES_PASSWORD`, and `POSTGRES_USER`/`HOST`/`PORT` if they are not the
defaults) to move off SQLite.

## 1) Setup (Mac / Windows)

```bash
python -m venv .venv
source .venv/bin/activate   # Mac/Linux
# .venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

## 2) Run migrations + create admin user

```bash
python manage.py migrate
python manage.py createsuperuser
```

## 3) Start the server

```bash
python manage.py runserver
```

Open:
- http://127.0.0.1:8000/  (hub — pick an app)
- http://127.0.0.1:8000/plu/  (PLU search)
- http://127.0.0.1:8000/plu/photo-search/  (photo search)
- http://127.0.0.1:8000/plu/import/  (CSV import, staff only)
- http://127.0.0.1:8000/timesheet/  (clock in / out)
- http://127.0.0.1:8000/timesheet/shifts/  (timesheet)
- http://127.0.0.1:8000/admin/  (admin)

### Using it on your phone

Start the server so it listens on the network, not just localhost:

```bash
python manage.py runserver 0.0.0.0:8000
```

Then on a phone on the same Wi-Fi, open `http://<your-computer-ip>:8000/`
(`ipconfig getifaddr en0` on a Mac prints the IP). In Safari or Chrome use
**Share -> Add to Home Screen** to get an app icon that opens full screen.

## 4) CSV format

The header row must include `plu_no` and `description`. Any other columns
(`sales_mode`, `price`, `tare`, ...) are ignored, so a raw export from the
till system can be uploaded unedited.

```
plu_no,description
5000,BEEF PORTERHOUSE STEAK
5001,BEEF RUMP STEAK
```

Rows are matched on `plu_no`: an existing PLU is updated, a new one created.

Two CSVs are included:
- `sample_data/plu_sample.csv` — a small example
- `sample_data/plu_items.csv` — a full export of all PLUs, kept in version
  control as the backup of the list

The SQLite database is deliberately **not** committed (it holds password hashes
and session keys). After a fresh clone, run the migrations and then import
`sample_data/plu_items.csv` from the Import CSV page to restore the PLU list.
