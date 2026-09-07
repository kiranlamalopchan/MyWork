from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-change-me-20260305051257'
DEBUG = True

# In development the app is opened from a phone on the same Wi-Fi, which means
# the request arrives with the laptop's LAN IP as its Host header. Locking this
# to localhost would reject those with a 400, so allow any host while DEBUG.
if DEBUG:
    ALLOWED_HOSTS = ['*']
else:
    ALLOWED_HOSTS = ['127.0.0.1', 'localhost']


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'plu',
    'timeclock',
]


MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Must sit after AuthenticationMiddleware: it reads request.user to find
    # which timezone the user's phone reported.
    'timeclock.middleware.UserTimezoneMiddleware',
]


ROOT_URLCONF = 'mywork.urls'


TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                # Which of MyWork's apps the current page belongs to, so
                # base.html can render that app's navigation and nothing else.
                'mywork.context_processors.section',
            ],
        },
    },
]


WSGI_APPLICATION = 'mywork.wsgi.application'


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Australia/Darwin'

USE_I18N = True
USE_TZ = True


STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
# Where `collectstatic` gathers everything (including django.contrib.admin's
# own CSS/JS) into one directory for the host to serve directly.
STATIC_ROOT = BASE_DIR / 'staticfiles'


DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# -------------------------
# LOGIN / LOGOUT SETTINGS
# -------------------------

LOGIN_URL = '/login/'
# After signing in you land on the hub, where you pick an app.
LOGIN_REDIRECT_URL = '/'
LOGOUT_REDIRECT_URL = '/login/' 