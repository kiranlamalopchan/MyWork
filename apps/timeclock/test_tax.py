"""
Tax on the timesheet, the ATO's way: withheld from each pay, by what was
declared to that employer — see apps/timeclock/paygw.py for the formulas
themselves and test_paygw.py for the ATO's own sample figures.
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from . import paygw
from .forms import WorkplaceForm
from .models import PaidIn, PayCycle, Shift, TaxScale, Workplace, pay_total, price_shifts
from .views import _pay_state


def at(day, hour=9):
    return timezone.make_aware(datetime.combine(day, time(hour)), timezone.get_current_timezone())


class TaxedByThePayTests(TestCase):
    """Withholding is worked out on the whole pay, then shared by its shifts."""

    # A fortnight running Thursday 3 September to Wednesday 16 September 2026.
    ANCHOR = date(2026, 9, 3)

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.job = Workplace.objects.create(
            user=self.user, name="Courtlands", hourly_rate=Decimal("30.00"),
            pay_cycle=PayCycle.FORTNIGHT, fortnight_anchor=self.ANCHOR,
            tax_scale=TaxScale.TFT,
        )

    def shift(self, day, hours=10, job=None):
        start = at(day)
        return Shift.objects.create(
            user=self.user, workplace=job or self.job, clock_in=start,
            clock_out=start + timedelta(hours=hours), status=Shift.Status.COMPLETED,
        )

    def test_a_fortnights_pay_is_taxed_as_a_fortnight_not_shift_by_shift(self):
        shifts = [self.shift(date(2026, 9, d)) for d in (4, 8, 15)]  # $900

        total = pay_total(shifts)

        self.assertEqual(total.gross, 900.00)
        # Scale 2, fortnightly: $450.99 a week withholds $13, twice.
        self.assertEqual(total.tax, 26.00)
        self.assertEqual(total.tax, paygw.withhold(900, paygw.FORTNIGHT, paygw.TFT))
        # Taxed alone, each $300 shift would be under the threshold — the
        # mistake a per-shift percentage made the other way round.
        self.assertEqual(paygw.withhold(300, paygw.FORTNIGHT, paygw.TFT), 0)

    def test_the_shares_add_up_to_the_pay_to_the_cent(self):
        shifts = [self.shift(date(2026, 9, d), hours=h) for d, h in ((4, 7.5), (8, 9.25), (15, 11))]
        prices = price_shifts(shifts)

        gross = round(sum(p.gross for p in prices.values()), 2)
        self.assertEqual(
            round(sum(p.tax for p in prices.values()), 2),
            paygw.withhold(gross, paygw.FORTNIGHT, paygw.TFT),
        )
        for p in prices.values():
            self.assertAlmostEqual(p.gross - p.tax, p.net, places=2)

    def test_one_shift_is_priced_inside_its_whole_fortnight(self):
        first = self.shift(date(2026, 9, 4))
        self.shift(date(2026, 9, 8))
        self.shift(date(2026, 9, 15))

        # A third of the fortnight's $26.
        self.assertAlmostEqual(first.pay.tax, 26 / 3, delta=0.01)

    def test_a_closed_fortnight_on_the_pay_screen_withholds_what_the_ato_says(self):
        for d in (4, 8, 15):
            self.shift(date(2026, 9, d))

        run = next(r for r in _pay_state(self.job)["due"] if r["start"] == self.ANCHOR)

        self.assertEqual(run["pay"].tax, 26.00)
        self.assertEqual(run["pay"].net, 874.00)

    def test_your_own_payslip_comes_out_to_the_dollar(self):
        # Period ending 26/08/2026: $1,721.80 gross, $186.00 withheld.
        self.assertEqual(paygw.withhold("1721.80", paygw.FORTNIGHT, paygw.TFT), 186)

    def test_a_second_job_without_the_threshold_taxes_every_dollar(self):
        self.job.tax_scale = TaxScale.NO_TFT
        self.job.save()
        shifts = [self.shift(date(2026, 9, 4))]  # $300

        self.assertEqual(pay_total(shifts).tax, paygw.withhold(300, paygw.FORTNIGHT, paygw.NO_TFT))
        self.assertGreater(pay_total(shifts).tax, 0)

    def test_a_study_loan_adds_its_repayment_once_the_pay_is_high_enough(self):
        self.job.study_loan = True
        self.job.hourly_rate = Decimal("100.00")
        self.job.save()
        shifts = [self.shift(date(2026, 9, d), hours=12) for d in (4, 7, 8, 10, 14, 15)]  # $7,200

        with_loan = pay_total(shifts).tax
        self.job.study_loan = False
        self.job.save()
        for s in shifts:
            s.workplace = self.job
        self.assertGreater(with_loan, pay_total(shifts).tax)

    def test_a_job_that_pays_whenever_is_taxed_a_week_at_a_time(self):
        self.job.pay_cycle = PayCycle.IRREGULAR
        self.job.week_starts_on = 0  # Monday
        self.job.save()
        week1 = [self.shift(date(2026, 9, 7)), self.shift(date(2026, 9, 8))]    # $600
        week2 = [self.shift(date(2026, 9, 14)), self.shift(date(2026, 9, 15))]  # $600

        each = paygw.withhold(600, paygw.WEEK, paygw.TFT)
        self.assertEqual(pay_total(week1 + week2).tax, 2 * each)

    def test_a_working_holiday_maker_steps_up_after_45000_this_year(self):
        self.job.tax_scale = TaxScale.WHM
        self.job.hourly_rate = Decimal("1000.00")
        self.job.save()
        # $46,000 paid since 1 July, before this fortnight.
        for n in range(46):
            self.shift(date(2026, 7, 1) + timedelta(days=n), hours=1)
        this = [self.shift(date(2026, 9, 4), hours=1)]

        self.assertEqual(pay_total(this).tax, 300.00)  # 30%, not 15%

    def test_cash_has_no_tax_whatever_the_scale(self):
        self.job.paid_in = PaidIn.CASH
        self.job.save()

        self.assertEqual(pay_total([self.shift(date(2026, 9, 4), hours=40)]).tax, 0)
        self.assertFalse(self.job.withholds)

    def test_not_set_is_before_tax_and_says_so(self):
        self.job.tax_scale = ""
        self.job.save()

        self.assertEqual(pay_total([self.shift(date(2026, 9, 4), hours=40)]).tax, 0)
        self.assertFalse(self.job.withholds)

    def test_a_percentage_job_works_as_it_always_did(self):
        self.job.tax_scale = TaxScale.CUSTOM
        self.job.tax_rate = Decimal("10.80")
        self.job.save()

        self.assertEqual(pay_total([self.shift(date(2026, 9, 4))]).tax, 32.40)


class TaxFormTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")

    def data(self, **extra):
        base = {
            "name": "Courtlands", "address": "", "color": "", "pay_cycle": "FORTNIGHT",
            "paid_in": "BANK", "hourly_rate": "30", "tax_rate": "", "hours_limit": "",
            "limit_period": "FORTNIGHT", "week_starts_on": "0", "fortnight_starts_on": "3",
            "fortnight_phase": "this", "month_starts_on": "1",
        }
        base.update(extra)
        return base

    def save(self, data, instance=None):
        form = WorkplaceForm(data, instance=instance, user=self.user)
        self.assertTrue(form.is_valid(), form.errors)
        job = form.save(commit=False)
        job.user = self.user
        job.save()
        return job

    def test_a_first_job_starts_on_the_tax_free_threshold_and_a_second_does_not(self):
        self.assertEqual(WorkplaceForm(user=self.user).initial["tax_scale"], TaxScale.TFT)
        self.save(self.data(tax_scale="TFT"))
        self.assertEqual(WorkplaceForm(user=self.user).initial["tax_scale"], TaxScale.NO_TFT)

    def test_choosing_a_scale_drops_an_old_percentage(self):
        job = self.save(self.data(tax_scale="CUSTOM", tax_rate="12"))
        job = self.save(self.data(tax_scale="TFT", tax_rate="12"), instance=job)

        self.assertIsNone(job.tax_rate)
        self.assertTrue(job.withholds)

    def test_my_own_percentage_needs_the_percentage(self):
        form = WorkplaceForm(self.data(tax_scale="CUSTOM"), user=self.user)
        self.assertFalse(form.is_valid())
        self.assertIn("tax_rate", form.errors)

    def test_the_loan_only_sticks_where_schedule_8_applies_it(self):
        self.assertTrue(self.save(self.data(tax_scale="TFT", study_loan="on")).study_loan)
        self.assertFalse(self.save(self.data(name="Farm", tax_scale="WHM", study_loan="on")).study_loan)

    def test_an_older_app_typing_a_percentage_gets_the_percentage_way(self):
        job = self.save(self.data(tax_rate="11"))
        self.assertEqual(job.tax_scale, TaxScale.CUSTOM)

    def test_an_older_app_saving_other_things_leaves_the_scale_and_loan_alone(self):
        job = self.save(self.data(tax_scale="NO_TFT", study_loan="on"))
        job = self.save(self.data(name="Courtlands Aged Care"), instance=job)

        self.assertEqual(job.tax_scale, TaxScale.NO_TFT)
        self.assertTrue(job.study_loan)

    def test_the_site_form_offers_the_situation(self):
        self.client.force_login(self.user)
        html = self.client.get(reverse("timeclock:workplace_create")).content.decode()

        self.assertIn('name="tax_scale"', html)
        self.assertIn("Tax-free threshold claimed", html)
        self.assertIn('name="study_loan"', html)


class TaxApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw12345678")
        resp = self.client.post(reverse("api:login"), {"username": "kiran", "password": "pw12345678"})
        self.token = resp.json()["token"]
        Workplace.objects.create(
            user=self.user, name="Courtlands", hourly_rate=30, tax_scale=TaxScale.TFT, study_loan=True,
        )

    def test_the_app_is_told_the_scale_and_the_choices(self):
        body = self.client.get(
            reverse("api:workplaces"), HTTP_AUTHORIZATION=f"Token {self.token}"
        ).json()
        job = body["workplaces"][0]

        self.assertEqual(job["tax_scale"], "TFT")
        self.assertTrue(job["study_loan"])
        self.assertEqual(job["tax_label"], "tax-free threshold + HELP")
        self.assertIn("tax-free threshold + HELP", job["sub"])
        self.assertEqual([c["value"] for c in body["choices"]["tax_scales"]],
                         ["TFT", "NO_TFT", "FOREIGN", "WHM", "NO_TFN", "CUSTOM"])
        # One job already claims the threshold, so a new one starts without.
        self.assertEqual(body["new_tax_scale"], "NO_TFT")
