import os
import tempfile
import unittest
from unittest import mock

import app as app_module

# A fixed "now" aligned to a UTC day, which keeps bucket maths easy to read.
T0_MS = 1_800_000_000 // 86400 * 86400 * 1000
MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS


class ProxyTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        app_module.app.config["DB_PATH"] = os.path.join(self.tmp.name, "test.db")
        app_module.init_db()
        app_module.last_purge_ms = T0_MS

        self.now = T0_MS
        patcher = mock.patch.object(app_module, "now_ms", lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.client = app_module.app.test_client()

    def post_temp(self, temperature=20.0, humidity=50.0):
        response = self.client.post(
            "/api/temperatura", json={"temperatura": temperature, "humidade": humidity}
        )
        self.assertEqual(response.status_code, 200)

    def post_wind(self, speed=5.0):
        response = self.client.post("/api/vento", json={"velocidade": speed})
        self.assertEqual(response.status_code, 200)

    def status(self):
        response = self.client.get("/api/status")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def count(self, table):
        connection = app_module.connect()
        try:
            return connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        finally:
            connection.close()


class StatusTests(ProxyTestCase):
    def test_empty_database_reports_all_metrics_without_data(self):
        data = self.status()
        for metric in app_module.METRICS:
            self.assertIsNone(data[metric]["valor"])
            self.assertIsNone(data[metric]["idade_s"])
            self.assertTrue(data[metric]["expirado"])
            self.assertEqual(
                data[metric]["estatisticas"]["3h"], {"max": None, "media": None, "min": None}
            )

    def test_temperature_only_does_not_leak_into_wind(self):
        self.post_temp(21.0, 60.0)
        data = self.status()
        self.assertEqual(data["temperatura"]["valor"], 21.0)
        self.assertEqual(data["humidade"]["valor"], 60.0)
        self.assertIsNone(data["vento"]["valor"])
        self.assertTrue(data["vento"]["expirado"])

    def test_wind_only_does_not_fail_or_leak(self):
        self.post_wind(7.5)
        data = self.status()
        self.assertEqual(data["vento"]["valor"], 7.5)
        self.assertIsNone(data["temperatura"]["valor"])
        self.assertIsNone(data["humidade"]["valor"])

    def test_age_and_expiry(self):
        self.post_wind()
        self.now += 12_000
        self.assertEqual(self.status()["vento"]["idade_s"], 12)
        self.assertFalse(self.status()["vento"]["expirado"])

        self.now = T0_MS + 300_000
        self.assertFalse(self.status()["vento"]["expirado"])
        self.now = T0_MS + 301_000
        self.assertTrue(self.status()["vento"]["expirado"])

    def test_latest_value_is_most_recent(self):
        self.post_wind(1.0)
        self.now += 1000
        self.post_wind(2.0)
        self.assertEqual(self.status()["vento"]["valor"], 2.0)

    def test_window_stats_are_weighted_across_minutes(self):
        self.post_wind(1.0)
        self.now += 1000
        self.post_wind(2.0)
        self.now += MINUTE_MS
        self.post_wind(9.0)

        stats = self.status()["vento"]["estatisticas"]["3h"]
        self.assertEqual(stats["max"], 9.0)
        self.assertEqual(stats["min"], 1.0)
        self.assertEqual(stats["media"], 4.0)

    def test_windows_exclude_older_data(self):
        self.post_wind(10.0)
        self.now += 4 * HOUR_MS
        self.post_wind(2.0)

        stats = self.status()["vento"]["estatisticas"]
        self.assertEqual(stats["3h"]["max"], 2.0)
        self.assertEqual(stats["6h"]["max"], 10.0)
        self.assertEqual(stats["6h"]["media"], 6.0)
        self.assertEqual(stats["24h"]["min"], 2.0)


class ValidationTests(ProxyTestCase):
    def assert_rejected(self, path, body):
        response = self.client.post(path, data=body, content_type="application/json")
        self.assertEqual(response.status_code, 400, body)

    def test_bad_payloads_are_rejected_and_status_stays_healthy(self):
        self.post_temp(20.0, 50.0)
        self.post_wind(3.0)
        readings_before = self.count("readings")

        for bad in ('"abc"', "null", "NaN", "Infinity", "-Infinity", "true", "[1]", "{}", "1e999"):
            self.assert_rejected("/api/vento", '{"velocidade": %s}' % bad)
            self.assert_rejected("/api/temperatura", '{"temperatura": %s, "humidade": 50}' % bad)
            self.assert_rejected("/api/temperatura", '{"temperatura": 20, "humidade": %s}' % bad)

        for bad in ("not json", "[]", "[1, 2]", '"text"', "3", ""):
            self.assert_rejected("/api/vento", bad)
            self.assert_rejected("/api/temperatura", bad)

        self.assertEqual(self.count("readings"), readings_before)
        self.assertEqual(self.status()["vento"]["valor"], 3.0)

    def test_huge_integer_is_rejected(self):
        self.assert_rejected("/api/vento", '{"velocidade": 1%s}' % ("0" * 400))

    def test_out_of_range_values_are_rejected(self):
        self.assert_rejected("/api/vento", '{"velocidade": -0.1}')
        self.assert_rejected("/api/vento", '{"velocidade": 100.1}')
        self.assert_rejected("/api/temperatura", '{"temperatura": -40.1, "humidade": 50}')
        self.assert_rejected("/api/temperatura", '{"temperatura": 80.1, "humidade": 50}')
        self.assert_rejected("/api/temperatura", '{"temperatura": 20, "humidade": 100.1}')

    def test_temperature_post_stores_both_values_or_neither(self):
        self.assert_rejected("/api/temperatura", '{"temperatura": 20, "humidade": 101}')
        self.assertEqual(self.count("readings"), 0)
        self.assertEqual(self.count("readings_1m"), 0)

    def test_sensor_payloads_are_accepted_unchanged(self):
        response = self.client.post(
            "/api/temperatura",
            data='{"temperatura":23.4,"humidade":61.2}',
            content_type="application/json",
        )
        self.assertEqual((response.status_code, response.text), (200, "OK"))
        response = self.client.post(
            "/api/vento", data='{"velocidade":4.2}', content_type="application/json"
        )
        self.assertEqual((response.status_code, response.text), (200, "OK"))


class PersistenceTests(ProxyTestCase):
    def test_data_survives_restart(self):
        self.post_wind(6.5)
        self.post_temp(22.0, 55.0)

        # Same database file, as after a service restart.
        app_module.init_db()
        fresh_client = app_module.app.test_client()
        data = fresh_client.get("/api/status").get_json()

        self.assertEqual(data["vento"]["valor"], 6.5)
        self.assertEqual(data["temperatura"]["valor"], 22.0)
        self.assertEqual(data["vento"]["estatisticas"]["3h"]["max"], 6.5)


class RetentionTests(ProxyTestCase):
    def test_purge_removes_only_expired_rows(self):
        self.post_wind(1.0)
        raw_keep_after = T0_MS + (app_module.RAW_RETENTION_SECONDS * 1000)

        # Just inside raw retention: the original raw row is kept.
        self.now = raw_keep_after
        self.post_wind(2.0)
        self.assertEqual(self.count("readings"), 2)

        # Past raw retention: the raw row goes, its rollup stays.
        app_module.last_purge_ms = 0
        self.now = raw_keep_after + 1
        self.post_wind(3.0)
        self.assertEqual(self.count("readings"), 2)
        self.assertEqual(self.count("readings_1m"), 2)

        # Past rollup retention: the old rollup goes too.
        app_module.last_purge_ms = 0
        self.now = T0_MS + app_module.ROLLUP_RETENTION_SECONDS * 1000 + MINUTE_MS
        self.post_wind(4.0)
        self.assertEqual(self.count("readings"), 1)
        self.assertEqual(self.count("readings_1m"), 2)

    def test_purge_runs_at_most_once_per_interval(self):
        self.post_wind(1.0)
        self.now = T0_MS + app_module.RAW_RETENTION_SECONDS * 1000 + 1
        self.post_wind(2.0)
        self.assertEqual(self.count("readings"), 1)
        purge_time = app_module.last_purge_ms

        self.now += MINUTE_MS
        self.post_wind(3.0)
        self.assertEqual(app_module.last_purge_ms, purge_time)


class HistoryTests(ProxyTestCase):
    def history(self, periodo):
        response = self.client.get(f"/api/historico?periodo={periodo}")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_invalid_period_is_rejected(self):
        for query in ("", "?periodo=", "?periodo=2h", "?periodo=1y;drop"):
            self.assertEqual(self.client.get(f"/api/historico{query}").status_code, 400)

    def test_periods_have_expected_bucket_sizes(self):
        expected = {"3h": 60, "24h": 300, "7d": 1800, "30d": 7200, "1y": 86400}
        self.assertEqual(
            {period: bucket for period, (_, bucket) in app_module.HISTORY_PERIODS.items()},
            expected,
        )
        for period, bucket in expected.items():
            data = self.history(period)
            self.assertEqual(data["periodo"], period)
            self.assertEqual(data["intervalo_s"], bucket)
            self.assertTrue(all(t % bucket == 0 for t in data["t"]))
            for metric in app_module.METRICS:
                for field in ("media", "min", "max"):
                    self.assertEqual(len(data["series"][metric][field]), len(data["t"]))

    def test_buckets_aggregate_with_weighted_average(self):
        # Two readings in one minute and one in the next, all in one 5-minute bucket.
        self.post_wind(1.0)
        self.now += 1000
        self.post_wind(2.0)
        self.now += MINUTE_MS
        self.post_wind(9.0)

        data = self.history("24h")
        i = data["t"].index(T0_MS // 1000)
        wind = data["series"]["vento"]
        self.assertEqual(wind["media"][i], 4.0)
        self.assertEqual(wind["min"][i], 1.0)
        self.assertEqual(wind["max"][i], 9.0)
        self.assertIsNone(data["series"]["temperatura"]["media"][i])

    def test_gaps_are_null(self):
        self.post_wind(1.0)
        self.now += 30 * MINUTE_MS
        self.post_wind(2.0)

        data = self.history("3h")
        wind = data["series"]["vento"]["media"]
        first = data["t"].index(T0_MS // 1000)
        last = data["t"].index(T0_MS // 1000 + 30 * 60)
        self.assertEqual(wind[first], 1.0)
        self.assertEqual(wind[last], 2.0)
        self.assertTrue(all(value is None for value in wind[first + 1:last]))

    def test_period_excludes_older_data(self):
        self.post_wind(1.0)
        self.now += 4 * HOUR_MS
        data = self.history("3h")
        self.assertTrue(all(value is None for value in data["series"]["vento"]["media"]))
        self.assertEqual(self.history("24h")["series"]["vento"]["max"].count(1.0), 1)

    def test_history_outlives_raw_retention(self):
        self.post_wind(8.0)
        self.now += 8 * DAY_MS
        self.post_wind(1.0)  # triggers the purge of the raw row

        self.assertEqual(self.history("30d")["series"]["vento"]["max"].count(8.0), 1)


if __name__ == "__main__":
    unittest.main()
