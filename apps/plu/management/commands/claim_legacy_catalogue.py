"""Explicitly assign the old shared PLU list, without guessing its owner."""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from apps.plu.models import Catalogue, PluItem


class Command(BaseCommand):
    help = "Assign unowned legacy PLUs to a username as their private catalogue. Creates a separate My PLUs catalogue."

    def add_arguments(self, parser):
        parser.add_argument("username")

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            user = get_user_model().objects.select_for_update().get(username=options["username"])
        except get_user_model().DoesNotExist:
            raise CommandError("That username doesn't exist.")
        if Catalogue.objects.filter(owner=user, name__iexact="My PLUs").exists():
            raise CommandError("That account already has a My PLUs catalogue. Nothing was changed.")
        rows = list(PluItem.objects.select_for_update().filter(catalogue__isnull=True))
        if not rows:
            raise CommandError("There are no unowned legacy PLUs. Nothing was changed.")
        numbers = [item.plu_no for item in rows]
        if None in numbers or len(set(numbers)) != len(numbers):
            raise CommandError("The unowned list has missing or duplicate numbers. Nothing was changed.")
        catalogue = Catalogue.objects.create(owner=user, name="My PLUs", headers=["plu_no", "description"],
            title_column="description", code_column="plu_no", search_columns=["plu_no", "description"])
        for item in rows:
            item.catalogue = catalogue
            item.code = str(item.plu_no)
            item.title = item.description
            item.fields = {"plu_no": item.code, "description": item.description}
            item.search_text = f"{item.code}\n{item.description}"
        PluItem.objects.bulk_update(rows, ["catalogue", "code", "title", "fields", "search_text"], batch_size=500)
        self.stdout.write(self.style.SUCCESS(f"Assigned {len(rows)} PLUs privately to {user.username}."))
