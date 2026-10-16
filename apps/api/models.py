from django.conf import settings
from django.db import models


class ShiftReceipt(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    client_id = models.UUIDField()
    shift = models.ForeignKey('timeclock.Shift', on_delete=models.SET_NULL, null=True)
    payload_hash = models.CharField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'client_id'], name='unique_mobile_shift_submission')]


class SupportReport(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    description = models.TextField(max_length=4000)
    screenshot = models.ImageField(upload_to='support/%Y/%m/', blank=True)
    app_version = models.CharField(max_length=40, blank=True)
    build = models.CharField(max_length=40, blank=True)
    platform = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)

    def __str__(self):
        return f'Report {self.pk} from {self.user}'


class MobileRelease(models.Model):
    version = models.CharField(max_length=30, unique=True)
    title = models.CharField(max_length=120, default='A new update is available')
    message = models.CharField(max_length=200, default='Enjoy the latest improvements. Tap to open your app store.')
    android_url = models.URLField(default='https://play.google.com/store/apps/details?id=com.kiranlama.merokaam')
    ios_url = models.URLField(default='https://apps.apple.com/app/id6813073450')
    created_at = models.DateTimeField(auto_now_add=True)
    announced_at = models.DateTimeField(null=True, blank=True, editable=False)

    def __str__(self):
        return f'Mobile update {self.version}'
