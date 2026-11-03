import os
import sqlite3
import time

from flask import Flask, g, jsonify, request

app = Flask(__name__)
app.config["DB_PATH"] = os.environ.get(
    "WEATHER_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "weather.db"),
)

METRICS = ("temperatura", "humidade", "vento")

# Plausible (min, max) per metric; anything outside is rejected on ingest.
LIMITS = {
    "temperatura": (-40.0, 80.0),  # DHT22 operating range, in °C
    "humidade": (0.0, 100.0),      # %
    "vento": (0.0, 100.0),         # m/s
}

EXPIRY_SECONDS = 5 * 60
STATS_WINDOW_HOURS = (3, 6, 12, 24)

# periodo -> (span in seconds, bucket size in seconds)
HISTORY_PERIODS = {
    "3h": (3 * 3600, 60),
    "24h": (24 * 3600, 5 * 60),
    "7d": (7 * 86400, 30 * 60),
    "30d": (30 * 86400, 2 * 3600),
    "1y": (365 * 86400, 86400),
}

RAW_RETENTION_SECONDS = 7 * 86400
ROLLUP_RETENTION_SECONDS = 2 * 365 * 86400
PURGE_INTERVAL_SECONDS = 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    metric TEXT NOT NULL,
    ts_ms INTEGER NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (metric, ts_ms)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS readings_1m (
    metric TEXT NOT NULL,
    minute_ts INTEGER NOT NULL,
    n INTEGER NOT NULL,
    sum REAL NOT NULL,
    min REAL NOT NULL,
    max REAL NOT NULL,
    PRIMARY KEY (metric, minute_ts)
) WITHOUT ROWID;
"""

last_purge_ms = 0


def now_ms():
    return int(time.time() * 1000)


def connect():
    connection = sqlite3.connect(app.config["DB_PATH"], timeout=5)
    connection.execute("PRAGMA synchronous=NORMAL")
    return connection


def init_db():
    connection = connect()
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
    finally:
        connection.close()


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exception):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def parse_measure(payload, field, metric):
    """Return the value of `field` if valid for `metric`, otherwise None."""
    value = payload.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    low, high = LIMITS[metric]
    # The range check also rejects NaN and infinity.
    if not low <= value <= high:
        return None
    return float(value)


def store_readings(measures):
    """Store {metric: value} atomically, updating raw data and rollups."""
    global last_purge_ms

    timestamp = now_ms()
    minute_ts = timestamp // 60000 * 60
    db = get_db()

    with db:
        for metric, value in measures.items():
            db.execute(
                "INSERT OR REPLACE INTO readings (metric, ts_ms, value) VALUES (?, ?, ?)",
                (metric, timestamp, value),
            )
            db.execute(
                """
                INSERT INTO readings_1m (metric, minute_ts, n, sum, min, max)
                VALUES (?, ?, 1, ?, ?, ?)
                ON CONFLICT (metric, minute_ts) DO UPDATE SET
                    n = n + 1,
                    sum = sum + excluded.sum,
                    min = MIN(min, excluded.min),
                    max = MAX(max, excluded.max)
                """,
                (metric, minute_ts, value, value, value),
            )

        if timestamp - last_purge_ms >= PURGE_INTERVAL_SECONDS * 1000:
            purge_expired(db, timestamp)
            last_purge_ms = timestamp


def purge_expired(db, timestamp):
    db.execute(
        "DELETE FROM readings WHERE ts_ms < ?",
        (timestamp - RAW_RETENTION_SECONDS * 1000,),
    )
    db.execute(
        "DELETE FROM readings_1m WHERE minute_ts < ?",
        (timestamp // 1000 - ROLLUP_RETENTION_SECONDS,),
    )


def build_stats_for_measure(db, metric, timestamp):
    stats = {}
    now_s = timestamp // 1000

    for hours in STATS_WINDOW_HOURS:
        cutoff = (now_s - hours * 3600) // 60 * 60
        maximum, average, minimum = db.execute(
            """
            SELECT MAX(max), SUM(sum) / SUM(n), MIN(min)
            FROM readings_1m
            WHERE metric = ? AND minute_ts >= ?
            """,
            (metric, cutoff),
        ).fetchone()
        stats[f"{hours}h"] = {"max": maximum, "media": average, "min": minimum}

    return stats


@app.route("/api/temperatura", methods=["POST"])
def post_temperatura():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return "Erro: JSON inválido", 400

    temperature = parse_measure(payload, "temperatura", "temperatura")
    humidity = parse_measure(payload, "humidade", "humidade")
    if temperature is None or humidity is None:
        return "Erro: temperatura ou humidade inválida", 400

    store_readings({"temperatura": temperature, "humidade": humidity})
    return "OK", 200


@app.route("/api/vento", methods=["POST"])
def post_vento():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return "Erro: JSON inválido", 400

    speed = parse_measure(payload, "velocidade", "vento")
    if speed is None:
        return "Erro: velocidade inválida", 400

    store_readings({"vento": speed})
    return "OK", 200


@app.route("/api/status", methods=["GET"])
def get_status():
    db = get_db()
    timestamp = now_ms()
    result = {}

    for metric in METRICS:
        latest = db.execute(
            "SELECT value, ts_ms FROM readings WHERE metric = ? ORDER BY ts_ms DESC LIMIT 1",
            (metric,),
        ).fetchone()

        if latest is None:
            value, age_seconds = None, None
        else:
            value = latest[0]
            age_seconds = max(0, (timestamp - latest[1]) // 1000)

        result[metric] = {
            "valor": value,
            "idade_s": age_seconds,
            "expirado": age_seconds is None or age_seconds > EXPIRY_SECONDS,
            "estatisticas": build_stats_for_measure(db, metric, timestamp),
        }

    return jsonify(result)


@app.route("/api/historico", methods=["GET"])
def get_historico():
    periodo = request.args.get("periodo")
    if periodo not in HISTORY_PERIODS:
        return "Erro: período inválido", 400

    span, bucket = HISTORY_PERIODS[periodo]
    now_s = now_ms() // 1000
    start = (now_s - span) // bucket * bucket
    times = list(range(start, now_s // bucket * bucket + bucket, bucket))
    index_by_time = {t: i for i, t in enumerate(times)}

    db = get_db()
    series = {}

    for metric in METRICS:
        # Buckets with no rows stay null, so outages render as gaps.
        averages = [None] * len(times)
        minimums = [None] * len(times)
        maximums = [None] * len(times)

        rows = db.execute(
            """
            SELECT minute_ts / :bucket * :bucket AS bucket_ts,
                   SUM(sum) / SUM(n), MIN(min), MAX(max)
            FROM readings_1m
            WHERE metric = :metric AND minute_ts >= :start
            GROUP BY bucket_ts
            """,
            {"bucket": bucket, "metric": metric, "start": start},
        )
        for bucket_ts, average, minimum, maximum in rows:
            i = index_by_time.get(bucket_ts)
            if i is not None:
                averages[i], minimums[i], maximums[i] = average, minimum, maximum

        series[metric] = {"media": averages, "min": minimums, "max": maximums}

    return jsonify({"periodo": periodo, "intervalo_s": bucket, "t": times, "series": series})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
