def can_manage_festival(user):
    """The same staff + model permission required by Django's admin editor."""
    return bool(user.is_authenticated and user.is_active and user.is_staff and user.has_perm("holidays.change_festivalthemesettings"))
