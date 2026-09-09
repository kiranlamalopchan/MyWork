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

Adding a third app means starting it inside `apps/`, mounting it under its
own prefix in `mywork/urls.py`, and giving it an entry in
`mywork/context_processors.py` plus a card on the hub.

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

**Map `/media/avatars/`, not `/media/`.** Payslips live under
`/media/payslips/`, and a mapping on the parent would serve them straight off
the disk to anyone with the URL, going around the ownership check in
`payslip_view`. The filenames are random, which is a second lock and not a
substitute for the first one.

Finally **Reload** the web app — Django will not pick up new code or a changed
WSGI file until you do.

To see the site immediately without setting any of this up,
`mywork.settings.local` will serve it — but it runs with `DEBUG = True`, which
shows a full traceback and your settings to anybody who triggers an error. It
is for a laptop, not for a site with an address.

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
  timeclock/         clocking, timesheets, pay, payslips
  noticeboard/       the board both apps share
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
