# Butcher PLU App (Django)

This is a simple Django web app to:
- Search PLUs by number or description
- View PLU details
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
- http://127.0.0.1:8000/plu/  (search)
- http://127.0.0.1:8000/plu/import/  (CSV import)
- http://127.0.0.1:8000/admin/  (admin)

## 4) CSV format

Headers must be exactly:

```
plu_no,description,sales_mode,price,tare
```

A sample is included:
- sample_data/plu_sample.csv
# PLU-Management
# PLU-Management
