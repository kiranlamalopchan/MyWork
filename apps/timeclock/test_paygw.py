"""
The ATO's own figures, checked row by row.

The rows below are the ATO's published sample data for Schedule 1 from
1 July 2026 ("Withholding amounts sample data"): pay, then what scale 1
(no tax-free threshold), scale 2 (tax-free threshold claimed) and scale 3
(foreign resident) withhold from it. Software written to the schedule is
meant to be tested against exactly these, and paygw is.

The worked examples from Schedule 8 (study loans) and Schedule 15 (working
holiday makers) are checked the same way, figure for figure.
"""

from datetime import date

from django.test import SimpleTestCase

from . import paygw
from .paygw import FOREIGN, FORTNIGHT, MONTH, NO_TFN, NO_TFT, TFT, WEEK, WHM, withhold

ON = date(2026, 9, 30)

# (earnings, scale 1, scale 2, scale 3)
WEEKLY = [
    ("116", 17, 0, 35),
    ("117", 18, 0, 35),
    ("187", 28, 0, 56),
    ("188", 28, 0, 56),
    ("249", 41, 0, 75),
    ("250", 41, 0, 75),
    ("361", 64, 0, 108),
    ("362", 65, 0, 109),
    ("370", 66, 1, 111),
    ("371", 66, 1, 111),
    ("514", 92, 23, 154),
    ("515", 92, 23, 154),
    ("537", 99, 26, 161),
    ("538", 100, 27, 161),
    ("672", 143, 60, 202),
    ("673", 143, 60, 202),
    ("720", 158, 68, 216),
    ("721", 159, 68, 216),
    ("864", 205, 94, 259),
    ("865", 205, 94, 259),
    ("907", 219, 108, 272),
    ("908", 219, 108, 272),
    ("931", 227, 116, 279),
    ("932", 227, 116, 280),
    ("1134", 292, 181, 340),
    ("1135", 292, 181, 340),
    ("1281", 339, 229, 384),
    ("1282", 339, 229, 385),
    ("1844", 519, 409, 553),
    ("1845", 519, 409, 553),
    ("2119", 607, 497, 636),
    ("2120", 607, 497, 636),
    ("2245", 647, 537, 673),
    ("2246", 647, 537, 674),
    ("2490", 743, 615, 747),
    ("2491", 743, 616, 747),
    ("2595", 784, 649, 778),
    ("2596", 784, 649, 779),
    ("2652", 806, 671, 800),
    ("2653", 806, 672, 800),
    ("2736", 839, 704, 831),
    ("2737", 839, 704, 831),
    ("2898", 902, 767, 891),
    ("2899", 902, 768, 891),
    ("3302", 1059, 925, 1040),
    ("3303", 1060, 925, 1041),
    ("3652", 1224, 1061, 1170),
    ("3653", 1224, 1062, 1170),
]

FORTNIGHTLY = [
    ("232", 34, 0, 70),
    ("234", 36, 0, 70),
    ("374", 56, 0, 112),
    ("376", 56, 0, 112),
    ("498", 82, 0, 150),
    ("500", 82, 0, 150),
    ("722", 128, 0, 216),
    ("724", 130, 0, 218),
    ("740", 132, 2, 222),
    ("742", 132, 2, 222),
    ("1028", 184, 46, 308),
    ("1030", 184, 46, 308),
    ("1074", 198, 52, 322),
    ("1076", 200, 54, 322),
    ("1344", 286, 120, 404),
    ("1346", 286, 120, 404),
    ("1440", 316, 136, 432),
    ("1442", 318, 136, 432),
    ("1728", 410, 188, 518),
    ("1730", 410, 188, 518),
    ("1814", 438, 216, 544),
    ("1816", 438, 216, 544),
    ("1862", 454, 232, 558),
    ("1864", 454, 232, 560),
    ("2268", 584, 362, 680),
    ("2270", 584, 362, 680),
    ("2562", 678, 458, 768),
    ("2564", 678, 458, 770),
    ("3688", 1038, 818, 1106),
    ("3690", 1038, 818, 1106),
    ("4238", 1214, 994, 1272),
    ("4240", 1214, 994, 1272),
    ("4490", 1294, 1074, 1346),
    ("4492", 1294, 1074, 1348),
    ("4980", 1486, 1230, 1494),
    ("4982", 1486, 1232, 1494),
    ("5190", 1568, 1298, 1556),
    ("5192", 1568, 1298, 1558),
    ("5304", 1612, 1342, 1600),
    ("5306", 1612, 1344, 1600),
    ("5472", 1678, 1408, 1662),
    ("5474", 1678, 1408, 1662),
    ("5796", 1804, 1534, 1782),
    ("5798", 1804, 1536, 1782),
    ("6604", 2118, 1850, 2080),
    ("6606", 2120, 1850, 2082),
    ("7304", 2448, 2122, 2340),
    ("7306", 2448, 2124, 2340),
]

MONTHLY = [
    ("502.67", 74, 0, 152),
    ("507.00", 78, 0, 152),
    ("810.33", 121, 0, 243),
    ("814.67", 121, 0, 243),
    ("1079.00", 178, 0, 325),
    ("1083.33", 178, 0, 325),
    ("1564.33", 277, 0, 468),
    ("1568.67", 282, 0, 472),
    ("1603.33", 286, 4, 481),
    ("1607.67", 286, 4, 481),
    ("2227.33", 399, 100, 667),
    ("2231.67", 399, 100, 667),
    ("2327.00", 429, 113, 698),
    ("2331.33", 433, 117, 698),
    ("2912.00", 620, 260, 875),
    ("2916.33", 620, 260, 875),
    ("3120.00", 685, 295, 936),
    ("3124.33", 689, 295, 936),
    ("3744.00", 888, 407, 1122),
    ("3748.33", 888, 407, 1122),
    ("3930.33", 949, 468, 1179),
    ("3934.67", 949, 468, 1179),
    ("4034.33", 984, 503, 1209),
    ("4038.67", 984, 503, 1213),
    ("4914.00", 1265, 784, 1473),
    ("4918.33", 1265, 784, 1473),
    ("5551.00", 1469, 992, 1664),
    ("5555.33", 1469, 992, 1668),
    ("7990.67", 2249, 1772, 2396),
    ("7995.00", 2249, 1772, 2396),
    ("9182.33", 2630, 2154, 2756),
    ("9186.67", 2630, 2154, 2756),
    ("9728.33", 2804, 2327, 2916),
    ("9732.67", 2804, 2327, 2921),
    ("10790.00", 3220, 2665, 3237),
    ("10794.33", 3220, 2669, 3237),
    ("11245.00", 3397, 2812, 3371),
    ("11249.33", 3397, 2812, 3376),
    ("11492.00", 3493, 2908, 3467),
    ("11496.33", 3493, 2912, 3467),
    ("11856.00", 3636, 3051, 3601),
    ("11860.33", 3636, 3051, 3601),
    ("12558.00", 3909, 3324, 3861),
    ("12562.33", 3909, 3328, 3861),
    ("14308.67", 4589, 4008, 4507),
    ("14313.00", 4593, 4008, 4511),
    ("15825.33", 5304, 4598, 5070),
    ("15829.67", 5304, 4602, 5070),
]


class ScheduleOneSampleTests(SimpleTestCase):
    def _check(self, period, table):
        for pay, scale1, scale2, scale3 in table:
            with self.subTest(period=period, pay=pay):
                self.assertEqual(withhold(pay, period, NO_TFT, on=ON), scale1)
                self.assertEqual(withhold(pay, period, TFT, on=ON), scale2)
                self.assertEqual(withhold(pay, period, FOREIGN, on=ON), scale3)

    def test_weekly(self):
        self._check(WEEK, WEEKLY)

    def test_fortnightly(self):
        self._check(FORTNIGHT, FORTNIGHTLY)

    def test_monthly(self):
        self._check(MONTH, MONTHLY)

    def test_no_tfn_is_47_percent_cents_ignored(self):
        self.assertEqual(withhold("1000.99", WEEK, NO_TFN, on=ON), 470)
        self.assertEqual(withhold("333.50", WEEK, NO_TFN, on=ON), 156)  # 333 × 0.47 = 156.51

    def test_nothing_earned_nothing_withheld(self):
        self.assertEqual(withhold(0, WEEK, TFT, on=ON), 0)
        self.assertEqual(withhold(0, WEEK, WHM, on=ON), 0)


class StudyLoanTests(SimpleTestCase):
    """Schedule 8's worked examples: the component on top of the scale."""

    def _component(self, pay, period, scale):
        return withhold(pay, period, scale, study_loan=True, on=ON) - withhold(pay, period, scale, on=ON)

    def test_weekly_example(self):
        self.assertEqual(self._component("2608.36", WEEK, TFT), 193)

    def test_fortnightly_example(self):
        self.assertEqual(self._component("4409.75", FORTNIGHT, TFT), 260)

    def test_monthly_example_without_the_threshold(self):
        self.assertEqual(self._component("10627.88", MONTH, NO_TFT), 979)

    def test_below_the_repayment_threshold_adds_nothing(self):
        self.assertEqual(self._component("1336", WEEK, TFT), 0)
        self.assertEqual(self._component("986", WEEK, NO_TFT), 0)


class WorkingHolidayMakerTests(SimpleTestCase):
    """Schedule 15's worked examples."""

    def test_fifteen_percent_to_45000(self):
        self.assertEqual(withhold("680.70", WEEK, WHM, on=ON), 102)
        self.assertEqual(withhold("2825.75", MONTH, WHM, on=ON), 424)

    def test_thirty_percent_once_past_45000_this_year(self):
        self.assertEqual(withhold("8173.20", MONTH, WHM, paid_this_year=47000, on=ON), 2452)

    def test_top_rate_ignores_cents(self):
        # 0.45 × 1001 = 450.45 — cents dropped, not rounded.
        self.assertEqual(withhold("1001", WEEK, WHM, paid_this_year=200000, on=ON), 450)


class YearTests(SimpleTestCase):
    def test_the_financial_year_starts_on_1_july(self):
        self.assertEqual(paygw.financial_year_start(date(2026, 6, 30)), date(2025, 7, 1))
        self.assertEqual(paygw.financial_year_start(date(2026, 7, 1)), date(2026, 7, 1))

    def test_a_later_date_uses_the_latest_year_published(self):
        self.assertIs(paygw.year_for(date(2030, 1, 1)), paygw.YEARS[max(paygw.YEARS)])
