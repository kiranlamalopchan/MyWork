from django.db import models

class PluItem(models.Model):
    plu_no = models.IntegerField(unique=True)
    description = models.CharField(max_length=255)

    def __str__(self):
        return f"{self.plu_no} - {self.description}"