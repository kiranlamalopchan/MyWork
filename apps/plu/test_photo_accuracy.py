"""Photo search regressions: similar cuts, OCR noise, codes and layout retries."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from PIL import Image

from . import picking


def item(code, description, title=""):
    return SimpleNamespace(plu_no=code, description=description, title=title)


class PhotoMatchAccuracyTests(SimpleTestCase):
    def setUp(self):
        self.items = [
            item(900, "BEEF MINCE"), item(901, "BEEF MINCE PREMIUM"),
            item(1319, "LAMB LEG CHOPS"), item(1357, "LAMB BBQ CHOPS"),
            item(2000, "BEEF BONELESS FILLET"), item(2001, "PORK BONELESS FILLET"),
            item(2002, "BEEF BONE-IN FILLET"), item(2003, "CHICKEN THIGH FILLETS"),
        ]
        self.catalogue = picking.Catalogue(self.items)

    def test_punctuation_plurals_and_abbreviations_preserve_product_words(self):
        for text, expected in (
            ("beef-mince 500g", 900), ("CHKN thigh fillet", 2003),
            ("pork b/less fillets", 2001), ("beef bone in fillet", 2002),
            ("lamb leg chop", 1319), ("beef m1nce premium", 901),
        ):
            with self.subTest(text=text):
                self.assertEqual(self.catalogue.match(text).item.plu_no, expected)

    def test_imported_title_is_used_alongside_the_description(self):
        catalogue = picking.Catalogue([
            item(1, "Fresh chilled", "BEEF RUMP STEAK"),
            item(2, "Fresh chilled", "PORK LEG STEAK"),
        ])
        match = catalogue.match("pork leg steak")
        self.assertEqual(match.item.plu_no, 2)
        self.assertEqual(match.alternatives, [])

    def test_alternatives_with_distinct_titles_are_not_hidden_by_shared_description(self):
        catalogue = picking.Catalogue([
            item(1, "Fresh chilled", "CHICKEN BREAST FILLET"),
            item(2, "Fresh chilled", "CHICKEN THIGH FILLET"),
        ])
        match = catalogue.match("chicken fillet")
        self.assertEqual(len(match.alternatives), 1)

    def test_quantity_and_conflicting_codes_do_not_override_the_name(self):
        for text in ("beef mince premium 900", "PLU 900 beef mince premium"):
            with self.subTest(text=text):
                match = self.catalogue.match(text)
                self.assertEqual(match.item.plu_no, 901)
                self.assertFalse(match.by_code)
        self.assertEqual(picking.codes("beef mince x 900"), [])
        self.assertEqual(picking.codes("900 packs"), [])
        self.assertEqual(picking.codes("500 gms"), [])

    def test_unknown_name_does_not_become_a_confident_code_match(self):
        self.assertIsNone(self.catalogue.match("HALIBUT PLU 900").item)

    def test_a_species_or_preparation_conflict_does_not_become_an_alternative(self):
        match = self.catalogue.match("beef boneless fillet")
        self.assertEqual(match.item.plu_no, 2000)
        self.assertNotIn(2001, [candidate.plu_no for candidate, _ in match.alternatives])
        self.assertNotIn(2002, [candidate.plu_no for candidate, _ in match.alternatives])

    def test_close_alternatives_are_not_reported_as_sure(self):
        catalogue = picking.Catalogue([item(1, "LAMB LEG CHOPS"), item(2, "LAMB BBQ CHOPS")])
        match = catalogue.match("lamb chops")
        self.assertNotEqual(match.sureness, "sure")
        self.assertEqual(len(match.alternatives), 1)

    def test_fuzzy_words_are_weaker_than_exact_words(self):
        catalogue = picking.Catalogue([item(1, "SCOTCH FILLET"), item(2, "PORK MINCE")])
        exact = catalogue.match("scotch fillet")
        fuzzy = catalogue.match("scotch filiet")
        self.assertEqual(fuzzy.item.plu_no, 1)
        self.assertLess(fuzzy.score, exact.score)

    def test_low_ocr_confidence_downgrades_even_an_exact_code(self):
        match = picking.match_lines([picking.Line("PLU 900", 30)], self.items)[0][1]
        self.assertEqual(match.item.plu_no, 900)
        self.assertEqual(match.sureness, "unsure")
        self.assertFalse(match.by_code)

    def test_labelled_short_code_still_works(self):
        catalogue = picking.Catalogue([item(2, "LAMB LEG")])
        self.assertTrue(catalogue.match("PLU 2").by_code)
        self.assertTrue(catalogue.match("PLU2").by_code)
        self.assertTrue(catalogue.match("#2").by_code)
        self.assertIsNone(catalogue.match("2").item)


class PhotoReadAccuracyTests(SimpleTestCase):
    def read(self, side_effect):
        image = Image.new("L", (100, 100), 255)
        with patch.object(picking, "open_photo", return_value=image), \
             patch.object(picking, "prepare", return_value=image), \
             patch.object(picking, "_ocr", side_effect=side_effect) as ocr:
            return picking.read_lines(object()), ocr

    def test_automatic_layout_recovers_a_more_complete_high_confidence_read(self):
        heading = [picking.Line("PRODUCT COLLECTION LIST FOR TODAY", 95)]
        complete = [picking.Line(text, 90) for text in (
            "PRODUCT COLLECTION LIST FOR TODAY", "BEEF MINCE 500g", "LAMB LEG CHOPS 2kg",
        )]
        lines, ocr = self.read([heading, complete])
        self.assertEqual(lines, complete)
        self.assertEqual([call.kwargs["psm"] for call in ocr.call_args_list], [6, 3])

    def test_failed_layout_pass_preserves_the_successful_read(self):
        good = [picking.Line("BEEF MINCE PREMIUM LAMB LEG CHOPS COLLECTION", 90)]
        lines, _ = self.read([good, RuntimeError("OCR timeout")])
        self.assertEqual(lines, good)

    def test_low_quality_read_tries_thresholding(self):
        poor = [picking.Line("BEEF M1NCE", 30)]
        good = [picking.Line("BEEF MINCE", 90)]
        lines, ocr = self.read([poor, poor, good])
        self.assertEqual(lines, good)
        self.assertEqual(ocr.call_count, 3)

    def test_total_failure_is_a_user_readable_error(self):
        with self.assertRaises(picking.Unreadable):
            self.read([RuntimeError("timeout")] * 3)
