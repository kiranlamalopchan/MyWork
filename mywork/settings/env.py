"""Reading configuration from a file beside the code.

Lifted out of production.py so that a laptop can read the same file a server
does. Before this, `.env` was a production-only idea, and the result was a
feature that worked on the deployed site and was silently absent locally —
which is a bad way to find out that half your configuration lives somewhere
the other half cannot see.
"""

import os


def load_env_file(path):
    """Read KEY=value lines into the environment, if the file is there.

    The web app and a console are different processes. Variables exported in
    one are invisible to the other, and the server's WSGI file is read only by
    the web app — so secrets set there leave `manage.py migrate` unable to
    start, which is exactly the wall this was written to remove. A file beside
    the code is read by both.

    A real environment variable always wins: setdefault, not assignment. That
    keeps a host that injects its own configuration in charge, and makes this
    a fallback rather than an override.

    Deliberately about ten lines and no dependency. It understands KEY=value,
    blank lines, # comments and surrounding quotes, which is the whole of what
    a file like this ever holds.
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
