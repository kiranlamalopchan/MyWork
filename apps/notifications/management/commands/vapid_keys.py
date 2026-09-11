"""
Make the keypair that identifies this site to every push service.

Run once, ever:

    python manage.py vapid_keys

and put the two lines it prints in .env. They are not rotated casually — a
browser subscribes to a specific public key, so replacing the pair silently
breaks every subscription already handed out and everybody has to turn
notifications on again.

The private key never leaves the server. The public one is printed into every
page, which is fine and is the point: it is what a browser needs in order to
subscribe, and it is useless for signing anything.
"""

import base64

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Generate a VAPID keypair for Web Push, as .env lines."

    def handle(self, *args, **options):
        try:
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives.serialization import (
                Encoding, PublicFormat,
            )
        except ImportError:
            raise CommandError(
                "cryptography is not installed. `pip install -r requirements.txt` "
                "brings it in with pywebpush."
            )

        # P-256, because it is the only curve Web Push defines.
        private = ec.generate_private_key(ec.SECP256R1())

        # The private key as its raw 32-byte scalar, and the public key as the
        # uncompressed point — the two shapes pywebpush and the browser's
        # `applicationServerKey` respectively expect. Base64url with the
        # padding stripped, which is how both travel.
        raw_private = private.private_numbers().private_value.to_bytes(32, "big")
        raw_public = private.public_key().public_bytes(
            Encoding.X962, PublicFormat.UncompressedPoint
        )

        self.stdout.write("# Web Push — add these to .env and restart.")
        self.stdout.write(f"VAPID_PRIVATE_KEY={_b64(raw_private)}")
        self.stdout.write(f"VAPID_PUBLIC_KEY={_b64(raw_public)}")
        self.stdout.write("VAPID_CONTACT_EMAIL=you@example.com")
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                "Keep the private key out of the repository. Replacing this pair "
                "later invalidates every subscription already granted."
            )
        )


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
