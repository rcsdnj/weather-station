from flask import Flask, request, jsonify
from datetime import datetime, timedelta

app = Flask(__name__)

MAX_HISTORY_LENGTH = 524288
historyAchievedMaxSize = False

dataHistory = {'temperatura': [], 'humidade': [], 'vento': []}


def is_expired(timestamp):
    if timestamp is None:
        return True
    return (datetime.now() - timestamp) > timedelta(minutes=5)


def get_values_in_last_hours(measure_type, hours):
    cutoff = datetime.now() - timedelta(hours=hours)
    return [
        entry["value"]
        for entry in dataHistory[measure_type]
        if entry.get("timestamp") is not None
        and entry["timestamp"] >= cutoff
        and entry.get("value") is not None
    ]


def calculate_stats(values):
    if not values:
        return {
            "max": None,
            "media": None,
            "min": None
        }

    return {
        "max": max(values),
        "media": sum(values) / len(values),
        "min": min(values)
    }


def build_stats_for_measure(measure_type):
    stats = {}

    for hours in [3, 6, 12, 24]:
        values = get_values_in_last_hours(measure_type, hours)

        if values:
            stats[f"{hours}h"] = {
                "max": max(values),
                "media": sum(values) / len(values),
                "min": min(values)
            }
        else:
            stats[f"{hours}h"] = {
                "max": None,
                "media": None,
                "min": None
            }

    return stats


@app.route("/api/temperatura", methods=["POST"])
def post_temperatura():
    try:
        payload = request.get_json()

        postTime = datetime.now()
        temperatureEntry = {'value': payload.get("temperatura"), 'timestamp': postTime}
        humidityEntry = {'value': payload.get("humidade"), 'timestamp': postTime}

        dataHistory['temperatura'].append(temperatureEntry)
        dataHistory['humidade'].append(humidityEntry)

        pruneHistoryIfNeeded()

        return "OK", 200
    except Exception as e:
        return f"Erro: {str(e)}", 400


@app.route("/api/vento", methods=["POST"])
def post_vento():
    try:
        payload = request.get_json()

        postTime = datetime.now()
        windEntry = {'value': payload.get("velocidade"), 'timestamp': postTime}

        dataHistory['vento'].append(windEntry)

        pruneHistoryIfNeeded()

        return "OK", 200
    except Exception as e:
        return f"Erro: {str(e)}", 400


@app.route("/api/status", methods=["GET"])
def get_status():
    result = {}

    for measureType in dataHistory.keys():
        if len(dataHistory[measureType]) > 0:
            latest_entry = dataHistory[measureType][-1]

    result[measureType] = {
        "valor": latest_entry['value'],
        "expirado": is_expired(latest_entry['timestamp']),
        "estatisticas": build_stats_for_measure(measureType)
    }

    return jsonify(result)


def pruneHistoryIfNeeded():
    global historyAchievedMaxSize

    for measureType in dataHistory.keys():
        if len(dataHistory[measureType]) >= MAX_HISTORY_LENGTH:
            del dataHistory[measureType][0]
            if historyAchievedMaxSize is False:
                print(f"Historic achieved {MAX_HISTORY_LENGTH} entries, removing the oldest")
                historyAchievedMaxSize = True


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)