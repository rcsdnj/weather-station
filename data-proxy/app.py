from flask import Flask, request, jsonify
from datetime import datetime, timedelta

app = Flask(__name__)

MAX_HISTORY_LENGTH = 524288

dataHistory = {'temperatura': [], 'humidade': [], 'velocidade': []}

def is_expired(timestamp):
    if timestamp is None:
        return True
    return (datetime.now() - timestamp) > timedelta(minutes=5)

@app.route("/api/temperatura", methods=["POST"])
def post_temperatura():
    try:
        payload = request.get_json()

        postTime = datetime.now()
        temperatureEntry = dict['value': payload.get("temperatura"), 'timestamp': postTime]
        humidityEntry = dict['value': payload.get("humidade"), 'timestamp': postTime]

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
        temperatureEntry = dict['value': payload.get("velocidade"), 'timestamp': postTime]

        dataHistory['velocidade'].append(temperatureEntry)
        
        pruneHistoryIfNeeded()
        
        return "OK", 200
    except Exception as e:
        return f"Erro: {str(e)}", 400

@app.route("/api/status", methods=["GET"])
def get_status():
    result = {}
    
    for measureType in dataHistory.keys():
        if len(dataHistory[measureType]) > 0:
            result[measureType] = {
                "valor": dataHistory[measureType][-1]['value'],
                "expirado": is_expired(dataHistory[measureType][-1]['timestamp'])
            }
    
    return jsonify(result)

def pruneHistoryIfNeeded():
    for measureType in dataHistory.keys():
        if len(dataHistory[measureType]) >= MAX_HISTORY_LENGTH:
            del dataHistory[measureType][0]


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
