# Butcher PLU App (Django)

This is a simple Django web app to:
- Search PLUs by number or description (live, as you type)
- View PLU details and copy the code for the scale
- Read a picking-list photo and match each line to a PLU
- Import PLUs from a CSV file
- Manage PLUs in Django Admin

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
- http://127.0.0.1:8000/  (search)
- http://127.0.0.1:8000/photo-search/  (photo search)
- http://127.0.0.1:8000/import/  (CSV import, staff only)
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
# PLU-Management
# PLU-Management
