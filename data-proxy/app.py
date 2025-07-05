from flask import Flask, request, jsonify
from datetime import datetime, timedelta

app = Flask(__name__)

# Armazena os dados e timestamps
data_store = {
    "temperatura": None,
    "humidade": None,
    "vento": None
}
timestamps = {
    "temperatura": None,
    "humidade": None,
    "vento": None
}

def is_expired(timestamp):
    if timestamp is None:
        return True
    return (datetime.now() - timestamp) > timedelta(minutes=5)

@app.route("/api/temperatura", methods=["POST"])
def post_temperatura():
    try:
        payload = request.get_json()
        data_store["temperatura"] = payload.get("temperatura")
        data_store["humidade"] = payload.get("humidade")
        timestamps["temperatura"] = datetime.now()
        timestamps["humidade"] = datetime.now()
        return "OK", 200
    except Exception as e:
        return f"Erro: {str(e)}", 400

@app.route("/api/vento", methods=["POST"])
def post_vento():
    try:
        payload = request.get_json()
        data_store["vento"] = payload.get("velocidade")
        timestamps["vento"] = datetime.now()
        return "OK", 200
    except Exception as e:
        return f"Erro: {str(e)}", 400

@app.route("/api/status", methods=["GET"])
def get_status():
    result = {}
    for tipo in data_store:
        result[tipo] = {
            "valor": data_store[tipo],
            "expirado": is_expired(timestamps[tipo])
        }
    return jsonify(result)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
