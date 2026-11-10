"""Provider credentials stay on the server, loaded after .env."""
import os


def social_settings():
    return {
        'SOCIAL_AUTH_BASE_URL': os.environ.get('SOCIAL_AUTH_BASE_URL', '').rstrip('/'),
        'SOCIAL_GOOGLE_CLIENT_ID': os.environ.get('GOOGLE_OAUTH_CLIENT_ID', ''),
        'SOCIAL_GOOGLE_CLIENT_SECRET': os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET', ''),
        'SOCIAL_APPLE_CLIENT_ID': os.environ.get('APPLE_OAUTH_CLIENT_ID', ''),
        'SOCIAL_APPLE_TEAM_ID': os.environ.get('APPLE_OAUTH_TEAM_ID', ''),
        'SOCIAL_APPLE_KEY_ID': os.environ.get('APPLE_OAUTH_KEY_ID', ''),
        'SOCIAL_APPLE_PRIVATE_KEY': os.environ.get('APPLE_OAUTH_PRIVATE_KEY', '').replace('\\n', '\n'),
    }
