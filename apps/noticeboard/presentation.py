"""The thread layout shared by the website and API."""

# Keep the newest entries visible so a new reply never disappears into a fold.
COMMENTS_SHOWN = 3
REPLIES_SHOWN = 2


def fold_thread(items, keep):
    """Return older and recent items, keeping new replies outside the fold."""
    cut = max(len(items) - keep, 0)
    return items[:cut], items[cut:]
