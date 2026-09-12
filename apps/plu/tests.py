"""
PLU search: what comes back, and in what order.

The order is the whole feature. Someone is standing at a scale with a queue
behind them, so the row they want has to be the row they see first.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import PluItem
from .views import PRIORITY_FIRST, PRIORITY_LAST, search_plu_items


class PrioritySearchTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)

        # The same word in and out of the priority band, so ordering is the
        # only thing that can put one before the other.
        self.band_middle = PluItem.objects.create(plu_no=7050, description="BEEF MINCE")
        self.band_first = PluItem.objects.create(plu_no=PRIORITY_FIRST, description="BEEF BLADE")
        self.band_last = PluItem.objects.create(plu_no=PRIORITY_LAST, description="BEEF SHIN")
        self.below = PluItem.objects.create(plu_no=6999, description="BEEF RIBS")
        self.above = PluItem.objects.create(plu_no=7101, description="BEEF CHEEK")
        self.far = PluItem.objects.create(plu_no=1234, description="BEEF OSSO BUCCO")

    def codes(self, q):
        return [item.plu_no for item in search_plu_items(q)]

    # ---- the band comes first -------------------------------------------

    def test_the_band_leads_a_description_search(self):
        codes = self.codes("beef")
        self.assertEqual(codes[:3], [PRIORITY_FIRST, 7050, PRIORITY_LAST])
        self.assertEqual(codes[3:], [1234, 6999, 7101])

    def test_both_ends_of_the_band_are_inside_it(self):
        # 7000 and 7100 are in; 6999 and 7101 are out.
        codes = self.codes("beef")
        self.assertLess(codes.index(PRIORITY_LAST), codes.index(6999))
        self.assertLess(codes.index(PRIORITY_FIRST), codes.index(7101))

    def test_the_band_beats_a_better_description_match(self):
        # "MINCE" starts this one, which used to be enough to lead. The band
        # is now the stronger signal.
        PluItem.objects.create(plu_no=200, description="MINCE BEEF PREMIUM")
        self.assertEqual(self.codes("mince")[0], 7050)

    def test_the_band_leads_the_unfiltered_list(self):
        codes = self.codes("")
        self.assertEqual(codes[:3], [PRIORITY_FIRST, 7050, PRIORITY_LAST])

    def test_within_the_band_it_is_still_lowest_number_first(self):
        PluItem.objects.create(plu_no=7002, description="BEEF BRISKET")
        codes = self.codes("beef")
        self.assertEqual(codes[:4], [PRIORITY_FIRST, 7002, 7050, PRIORITY_LAST])

    # ---- except a code typed in full ------------------------------------

    def test_a_code_typed_in_full_still_wins(self):
        # Typing 1234 and being handed 7000 would be the search arguing with
        # you about a code you already know.
        self.assertEqual(self.codes("1234")[0], 1234)

    def test_a_code_typed_in_full_wins_even_from_outside_the_band(self):
        self.assertEqual(self.codes("6999")[0], 6999)

    def test_a_partial_code_still_prefers_the_band(self):
        PluItem.objects.create(plu_no=7005, description="BEEF CUBE ROLL")
        # "700" matches 7000 and 7005 by prefix, both in the band.
        self.assertEqual(self.codes("700")[:2], [PRIORITY_FIRST, 7005])

    # ---- the rest of search is unchanged --------------------------------

    def test_words_still_match_in_any_order(self):
        PluItem.objects.create(plu_no=8000, description="LAMB BONE-IN BBQ CHOPS")
        self.assertEqual(self.codes("chops lamb"), [8000])

    def test_a_word_that_matches_nothing_returns_nothing(self):
        self.assertEqual(self.codes("halibut"), [])

    # ---- and it reaches both front doors --------------------------------

    def test_the_search_page_lists_the_band_first(self):
        resp = self.client.get(reverse("plu:list"), {"q": "beef"})
        codes = [item.plu_no for item in resp.context["page_obj"]]
        self.assertEqual(codes[:3], [PRIORITY_FIRST, 7050, PRIORITY_LAST])

    def test_the_live_search_endpoint_lists_the_band_first(self):
        resp = self.client.get(reverse("plu:search_api"), {"q": "beef"})
        codes = [row["plu_no"] for row in resp.json()["results"]]
        self.assertEqual(codes[:3], [PRIORITY_FIRST, 7050, PRIORITY_LAST])


class PickingListMatchTests(TestCase):
    """
    A photographed picking list, line by line: the cut each line means.

    No photo here — the OCR is Tesseract's — only what is done with the
    words it gives back, which is where a line goes wrong or right.
    """

    def setUp(self):
        from . import picking

        self.picking = picking
        rows = [
            (1, "BEEF BONELESS SCOTCH FILLET"), (2, "BEEF BONELESS SLICED CHUCK"),
            (3, "BEEF BONELESS RUMP STEAK"), (8, "BEEF BONE-IN Y-BONE STEAK"),
            (900, "BEEF MINCE"), (901, "BEEF MINCE PREMIUM"), (1319, "LAMB LEG CHOPS"),
            (1320, "LAMB LEG"), (1357, "LAMB BBQ CHOPS"), (144, "CHICKEN THIGH FILLET"),
            (217, "PORK FILLET"), (7012, "SAUSAGES THIN BEEF"),
        ]
        self.items = [PluItem.objects.create(plu_no=n, description=d) for n, d in rows]
        self.catalogue = picking.Catalogue(self.items)

    def match(self, line):
        return self.catalogue.match(line)

    def test_the_rare_word_decides_the_cut(self):
        # BEEF is on half the list; SCOTCH is on one row.
        self.assertEqual(self.match("beef scotch 1kg").item.plu_no, 1)

    def test_a_misread_letter_still_finds_the_word(self):
        self.assertEqual(self.match("beef m1nce 500g").item.plu_no, 900)
        self.assertEqual(self.match("lamb ch0ps").item.plu_no, 1319)

    def test_the_tighter_description_wins_a_tie(self):
        # Both mince rows share both words; the one that is only those wins.
        self.assertEqual(self.match("beef mince").item.plu_no, 900)

    def test_a_code_on_the_sheet_is_believed(self):
        m = self.match("PLU 7012")
        self.assertEqual(m.item.plu_no, 7012)
        self.assertTrue(m.by_code)
        self.assertEqual(self.match("7012").item.plu_no, 7012)

    def test_a_small_bare_number_is_a_quantity_not_a_code(self):
        self.assertIsNone(self.match("2").item)
        self.assertIsNone(self.match("2 x").item)

    def test_a_code_the_words_disagree_with_is_not_taken(self):
        # "lamb chops x 8": the 8 is a count, not Y-bone steak.
        self.assertEqual(self.match("lamb chops x 8").item.plu_no, 1319)

    def test_dates_and_weights_are_not_codes(self):
        self.assertEqual(self.picking.codes("Picking list 12/09/2026"), [])
        self.assertEqual(self.picking.codes("2kg mince 500g"), [])

    def test_a_line_with_nothing_on_the_list_comes_back_empty(self):
        m = self.match("John Smith order")
        self.assertIsNone(m.item)
        self.assertEqual(m.sureness, "none")

    def test_one_common_word_is_only_likely(self):
        m = self.match("lamb")
        self.assertIsNotNone(m.item)
        self.assertEqual(m.sureness, "likely")

    def test_an_unknown_word_lowers_the_sureness(self):
        # PORK FILLET is the only pork; "bely" is not a word the list knows.
        m = self.match("pork bely")
        self.assertEqual(m.item.plu_no, 217)
        self.assertNotEqual(m.sureness, "sure")

    def test_the_runners_up_come_with_the_answer(self):
        m = self.match("lamb chops")
        self.assertEqual(m.item.plu_no, 1319)
        self.assertIn(1357, [item.plu_no for item, _ in m.alternatives])

    def test_lines_that_are_not_items_are_dropped(self):
        lines = [self.picking.Line(t, 90) for t in ["----", "beef mince", "12/09/2026"]]
        out = self.picking.match_lines(lines, self.items)
        self.assertEqual([line.text for line, _ in out], ["beef mince"])


class PhotoSearchPickTests(TestCase):
    """Putting a line of the read right, and the PDF following it."""

    def setUp(self):
        self.user = User.objects.create_user("kiran", password="pw")
        self.client.force_login(self.user)
        self.mince = PluItem.objects.create(plu_no=900, description="BEEF MINCE")
        self.chops = PluItem.objects.create(plu_no=1319, description="LAMB LEG CHOPS")
        session = self.client.session
        session["photo_search_lines"] = [
            {"line": "lamb chops", "plu_no": 900, "score": 0.5, "sureness": "likely",
             "by_code": False, "alternatives": [1319]},
        ]
        session.save()

    def test_a_read_kept_by_the_old_version_still_shows(self):
        session = self.client.session
        session["photo_search_lines"] = [{"line": "lamb chops", "plu_no": 1319}, {"line": "x", "plu_no": None}]
        session.save()
        resp = self.client.get(reverse("plu:photo_search"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "LAMB LEG CHOPS")
        resp = self.client.post(reverse("plu:photo_search_pick"), {"index": 0, "plu_no": 900})
        self.assertEqual(self.client.session["photo_search_lines"][0]["plu_no"], 900)

    def test_the_last_read_is_shown_again_on_a_refresh(self):
        resp = self.client.get(reverse("plu:photo_search"))
        self.assertContains(resp, "BEEF MINCE")
        self.assertContains(resp, "Likely")

    def test_a_line_can_be_changed_to_a_runner_up(self):
        resp = self.client.post(
            reverse("plu:photo_search_pick"), {"index": 0, "plu_no": 1319},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "LAMB LEG CHOPS")
        self.assertContains(resp, "You chose")
        self.assertEqual(self.client.session["photo_search_lines"][0]["plu_no"], 1319)

    def test_a_line_can_be_taken_out(self):
        resp = self.client.post(
            reverse("plu:photo_search_pick"), {"index": 0, "plu_no": ""},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 204)
        self.assertIsNone(self.client.session["photo_search_lines"][0]["plu_no"])
        resp = self.client.get(reverse("plu:photo_search"))
        self.assertNotContains(resp, "BEEF MINCE")

    def test_lines_that_matched_nothing_are_left_out_and_counted(self):
        from . import picking
        from .views import _remember

        PluItem.objects.create(plu_no=1, description="BEEF SCOTCH FILLET")
        lines = [picking.Line(t, 90) for t in ["Customer: J. Smith", "beef scotch", "Thanks!"]]
        matched = picking.match_lines(lines, PluItem.objects.all())

        class Req:
            session = {}
        req = Req()
        _remember(req, matched)
        self.assertEqual([r["plu_no"] for r in req.session["photo_search_lines"]], [1])
        self.assertEqual(req.session["photo_search_skipped"], 1)

    def test_clear_forgets_the_read(self):
        resp = self.client.post(reverse("plu:photo_search_clear"), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(resp.status_code, 204)
        self.assertNotIn("photo_search_lines", self.client.session)
        resp = self.client.get(reverse("plu:photo_search"))
        self.assertNotContains(resp, "BEEF MINCE")
        self.assertNotContains(resp, "Clear")

    def test_a_number_not_on_the_list_is_refused(self):
        resp = self.client.post(
            reverse("plu:photo_search_pick"), {"index": 0, "plu_no": 4242},
            HTTP_X_REQUESTED_WITH="XMLHttpRequest",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.client.session["photo_search_lines"][0]["plu_no"], 900)

    def test_the_pdf_follows_the_correction(self):
        self.client.post(reverse("plu:photo_search_pick"), {"index": 0, "plu_no": 1319})
        resp = self.client.get(reverse("plu:photo_search_pdf"))
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_a_fetch_gets_the_results_alone(self):
        resp = self.client.get(reverse("plu:photo_search"), HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertNotContains(resp, 'id="photo-form"')
        self.assertContains(resp, "BEEF MINCE")
