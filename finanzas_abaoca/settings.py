from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()
ENV_PATH = BASE_DIR / ".env"
if ENV_PATH.exists():
    environ.Env.read_env(str(ENV_PATH))

SECRET_KEY = env.str("SECRET_KEY", default="change-me")
SHEET_PATH = env.str("SHEET_PATH", default="")
SERVICE = env.str("GOOGLE_CLOUD_CREDENTIALS", default="")
DRIVE_FOLDER_ID = env.str("DRIVE_FOLDER_ID", default="")
SECURITY_CODE = env.str("SECURITY_CODE", default="000000")

ENVIRONMENT = env.str("ENVIRONMENT", default="dev").lower()
DEBUG = env.bool("DEBUG", default=ENVIRONMENT != "prod")

RENDER_EXTERNAL_HOSTNAME = env.str("RENDER_EXTERNAL_HOSTNAME", default="")
_default_allowed_hosts = ["*"] if DEBUG else ["localhost", "127.0.0.1"]
if RENDER_EXTERNAL_HOSTNAME:
    _default_allowed_hosts.append(RENDER_EXTERNAL_HOSTNAME)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=_default_allowed_hosts)

CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
if not DEBUG and RENDER_EXTERNAL_HOSTNAME and not CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS = [f"https://{RENDER_EXTERNAL_HOSTNAME}"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "forms",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "finanzas_abaoca.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "finanzas_abaoca.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

CORS_ALLOW_ALL_ORIGINS = True
X_FRAME_OPTIONS = "ALLOWALL"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
