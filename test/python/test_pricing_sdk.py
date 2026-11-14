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

    def test_recommended_price_calculation_pure_iqm(self):
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

        quote = self.client.get_recommended_price(date="2026-11-20")
        self.assertEqual(quote["source"], "scraped_iqm")
        self.assertEqual(quote["recommended_price"], 4600.0)
        self.assertNotIn("undercut", quote)
        self.assertNotIn("discount", quote)

    def test_fallback_to_annual_baseline_when_no_listings(self):
        self.client.seed_annual_baselines()
        quote = self.client.get_recommended_price(date="2026-12-25")
        self.assertEqual(quote["source"], "annual_baseline")
        self.assertEqual(quote["recommended_price"], 7000.0)
        self.assertEqual(quote["horizon"], "PEAK")

if __name__ == "__main__":
    unittest.main()
