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
