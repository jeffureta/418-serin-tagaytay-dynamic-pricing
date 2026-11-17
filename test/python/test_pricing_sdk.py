import unittest
from condo_pricing_sdk import CondoPricingClient

class TestCondoPricingPythonSDK(unittest.TestCase):
    def setUp(self):
        self.client = CondoPricingClient(db_path=":memory:")

    def tearDown(self):
        self.client.close()

    def test_guardrails_default_and_update(self):
        guardrails = self.client.get_guardrails()
        self.assertEqual(guardrails["floor_price"], 2800.0)
        self.assertEqual(guardrails["ceiling_price"], 8500.0)
        self.assertNotIn("undercut", guardrails)
        self.assertNotIn("discount", guardrails)

        updated = self.client.update_guardrails(floor_price=3000.0, ceiling_price=9000.0)
        self.assertEqual(updated["floor_price"], 3000.0)
        self.assertEqual(updated["ceiling_price"], 9000.0)

    def test_annual_baseline_seeding_and_lookup(self):
        count = self.client.seed_annual_baselines()
        self.assertEqual(count, 365)

        christmas = self.client.get_annual_baseline("2026-12-25")
        self.assertIsNotNone(christmas)
        self.assertEqual(christmas["horizon"], "PEAK")
        self.assertEqual(christmas["baseline_iqm"], 7000.0)

    def test_recommended_price_calculation_rms_multipliers(self):
        self.client.seed_annual_baselines()

        # Insert test listings
        self.client.insert_listing(
            id="abnb_test_1",
            source="airbnb",
            title="Test 2BR Serin",
            bedrooms=2,
            price_per_night=4500.0,
            currency="PHP",
            latitude=14.1152,
            longitude=120.9621,
            distance_km=0.2,
            url="https://airbnb.com/test1"
        )
        self.client.insert_listing(
            id="abnb_test_2",
            source="airbnb",
            title="Test 2BR Wind",
            bedrooms=2,
            price_per_night=4700.0,
            currency="PHP",
            latitude=14.0989,
            longitude=120.9458,
            distance_km=2.5,
            url="https://airbnb.com/test2"
        )

        as_of = "2026-11-17"
        quote25 = self.client.get_recommended_price(date="2026-12-25", as_of_date=as_of)
        quote26 = self.client.get_recommended_price(date="2026-12-26", as_of_date=as_of)
        quote27 = self.client.get_recommended_price(date="2026-12-27", as_of_date=as_of)

        self.assertEqual(quote25["source"], "scraped_iqm")
        self.assertEqual(quote25["horizon"], "PEAK")
        self.assertEqual(quote25["horizon_multiplier"], 1.65)

        self.assertEqual(quote26["horizon"], "WEEKEND")
        self.assertEqual(quote26["horizon_multiplier"], 1.25)

        self.assertEqual(quote27["horizon"], "WEEKDAY")
        self.assertEqual(quote27["horizon_multiplier"], 1.00)

        # Distinct rates
        self.assertNotEqual(quote25["recommended_price"], quote26["recommended_price"])
        self.assertNotEqual(quote26["recommended_price"], quote27["recommended_price"])
        self.assertGreater(quote25["recommended_price"], quote26["recommended_price"])
        self.assertGreater(quote26["recommended_price"], quote27["recommended_price"])

    def test_fallback_to_annual_baseline_when_no_listings(self):
        self.client.seed_annual_baselines()
        quote = self.client.get_recommended_price(date="2026-12-25", as_of_date="2026-11-17")
        self.assertEqual(quote["source"], "annual_baseline")
        self.assertEqual(quote["recommended_price"], 7000.0)
        self.assertEqual(quote["horizon"], "PEAK")

    def test_stay_quote_range_calculation(self):
        self.client.seed_annual_baselines()
        stay = self.client.get_stay_quote(
            check_in_date="2026-12-25",
            check_out_date="2026-12-28",
            as_of_date="2026-11-17"
        )
        self.assertEqual(stay["nights"], 3)
        self.assertEqual(len(stay["breakdown"]), 3)
        self.assertEqual(stay["stay_subtotal"], sum(b["recommended_price"] for b in stay["breakdown"]))

if __name__ == "__main__":
    unittest.main()
