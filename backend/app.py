import os
import json
import uuid
import numpy as np
import joblib
import tensorflow as tf
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from pymongo import MongoClient, DESCENDING
from simulate import generate_sample
from train import train_and_evaluate

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

SECRET_KEY = os.environ.get("SECRET_KEY", "zcas-fyp-secret-key-change-in-prod")
NODE_KEY = os.environ.get("NODE_KEY", "node-secret-123")
MONGO_URI = os.environ.get("MONGO_URI", "")

serializer = URLSafeTimedSerializer(SECRET_KEY)

# Ensure ML artifacts exist on startup
if not os.path.exists("winner.joblib"):
    train_and_evaluate()

winner = joblib.load("winner.joblib")
le = joblib.load("labels.joblib")
scaler = joblib.load("scaler.joblib")
model_rf = joblib.load("model_rf.joblib")
model_nn = tf.keras.models.load_model("model_nn.keras")

with open("metrics.json") as f:
    MODEL_METRICS = json.load(f)

# Database setup (MongoDB Atlas in production, in-memory fallback for local tests)
use_mongo = False
db = None
if MONGO_URI:
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db = client["smart_fault_db"]
        use_mongo = True
        print("Connected to MongoDB Atlas successfully.")
    except Exception as e:
        print("MongoDB connection failed, falling back to memory:", e)

MEM_STORE = {
    "users": [],
    "nodes": [],
    "readings": [],
    "alerts": [],
    "reports": [],
    "sms_logs": []
}

DEFAULT_NODES = [
    {"node_id": "kanyama-01", "name": "Kanyama Zone A (Market Feeder)", "compound": "Kanyama", "lat": -15.4367, "lng": 28.2528, "status": "online"},
    {"node_id": "kanyama-02", "name": "Kanyama Zone B (Los Angeles Rd)", "compound": "Kanyama", "lat": -15.4412, "lng": 28.2465, "status": "online"},
    {"node_id": "matero-01", "name": "Matero North (Commonwealth Ave)", "compound": "Matero", "lat": -15.3744, "lng": 28.2683, "status": "online"},
    {"node_id": "matero-02", "name": "Matero East (Stadium Feeder)", "compound": "Matero", "lat": -15.3791, "lng": 28.2754, "status": "online"}
]

def seed_initial_data():
    demo_users = [
        {"username": "admin", "password_hash": generate_password_hash("admin123"), "role": "administrator", "phone": "+260977000001"},
        {"username": "officer", "password_hash": generate_password_hash("officer123"), "role": "safety_officer", "phone": "+260966000002"},
        {"username": "resident", "password_hash": generate_password_hash("resident123"), "role": "resident", "phone": "+260955000003"}
    ]
    if use_mongo:
        if db.users.count_documents({}) == 0:
            db.users.insert_many(demo_users)
        if db.nodes.count_documents({}) == 0:
            db.nodes.insert_many(DEFAULT_NODES)
    else:
        if not MEM_STORE["users"]:
            for u in demo_users:
                MEM_STORE["users"].append({**u, "_id": uuid.uuid4().hex[:8]})
        if not MEM_STORE["nodes"]:
            MEM_STORE["nodes"].extend(DEFAULT_NODES)

seed_initial_data()

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def predict_fault(v: float, i: float, leak: float, pf: float):
    features = np.array([[v, i, leak, pf]], dtype=float)
    if winner == "nn":
        probs = model_nn.predict(scaler.transform(features), verbose=0)[0]
    else:
        probs = model_rf.predict_proba(features)[0]
    idx = int(np.argmax(probs))
    label = str(le.inverse_transform([idx])[0])
    confidence = round(float(probs[idx]) * 100, 1)
    return label, confidence

def dispatch_sms(phone: str, message: str, alert_id: str):
    # Simulates Airtel/MTN Zambia SMS Aggregator while logging payload for auditability (NFR7)
    sms_record = {
        "id": uuid.uuid4().hex[:8],
        "alert_id": alert_id,
        "recipient": phone,
        "network": "MTN/Airtel ZM Gateway",
        "message": message,
        "status": "DELIVERED",
        "sent_at": now_iso()
    }
    if use_mongo:
        db.sms_logs.insert_one(sms_record)
    else:
        MEM_STORE["sms_logs"].insert(0, sms_record)
    return sms_record

def classify_and_store(node_id: str, v: float, i: float, leak: float, pf: float):
    label, confidence = predict_fault(v, i, leak, pf)
    ts = now_iso()
    reading_id = uuid.uuid4().hex[:8]

    reading_doc = {
        "id": reading_id,
        "node_id": node_id,
        "voltage": round(v, 1),
        "current": round(i, 2),
        "leakage_ma": round(leak, 1),
        "power_factor": round(pf, 2),
        "fault": label,
        "confidence": confidence,
        "timestamp": ts
    }

    if use_mongo:
        db.readings.insert_one({**reading_doc})
    else:
        MEM_STORE["readings"].insert(0, reading_doc)
        MEM_STORE["readings"] = MEM_STORE["readings"][:200]

    alert_doc = None
    if label != "normal":
        alert_id = uuid.uuid4().hex[:8]
        severity = "CRITICAL" if label in ("short_circuit", "earth_fault") else "WARNING"
        alert_doc = {
            "id": alert_id,
            "reading_id": reading_id,
            "node_id": node_id,
            "fault": label,
            "severity": severity,
            "confidence": confidence,
            "voltage": reading_doc["voltage"],
            "current": reading_doc["current"],
            "leakage_ma": reading_doc["leakage_ma"],
            "status": "open",
            "acknowledged_by": None,
            "acknowledged_at": None,
            "resolved_by": None,
            "resolved_at": None,
            "resolution_note": "",
            "created_at": ts
        }
        if use_mongo:
            db.alerts.insert_one({**alert_doc})
        else:
            MEM_STORE["alerts"].insert(0, alert_doc)

        # Isolated SMS notification (NFR7)
        try:
            sms_text = (
                f"ZESCO/LV SAFETY ALERT [{severity}]: {label.upper().replace('_', ' ')} "
                f"detected at {node_id} ({reading_doc['voltage']}V, {reading_doc['current']}A). "
                f"Confidence: {confidence}%."
            )
            dispatch_sms("+260966000002", sms_text, alert_id)
        except Exception as e:
            print("SMS Gateway Error (isolated):", e)

    return {"reading": reading_doc, "alert": alert_doc}

# Auth Decorator
def require_roles(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "").strip()
            if not token:
                return jsonify({"error": "Authentication token required"}), 401
            try:
                user_data = serializer.loads(token, max_age=8 * 3600)
            except (BadSignature, SignatureExpired):
                return jsonify({"error": "Session expired or invalid. Please log in again."}), 401

            if roles and user_data.get("role") not in roles:
                return jsonify({"error": "Access forbidden for your role"}), 403

            request.user = user_data
            return fn(*args, **kwargs)
        return wrapper
    return decorator

# --- PUBLIC & AUTH ENDPOINTS ---

@app.get("/api/health")
def health():
    return jsonify({
        "status": "healthy",
        "database": "mongodb_atlas" if use_mongo else "in_memory",
        "model": MODEL_METRICS
    })

@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    user = db.users.find_one({"username": username}) if use_mongo else next(
        (u for u in MEM_STORE["users"] if u["username"] == username), None
    )

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid username or password"}), 401

    token = serializer.dumps({"username": user["username"], "role": user["role"]})
    return jsonify({
        "token": token,
        "user": {"username": user["username"], "role": user["role"]}
    })

@app.post("/api/auth/register")
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    phone = str(data.get("phone", "")).strip()

    if len(username) < 3 or len(password) < 6:
        return jsonify({"error": "Username must be 3+ chars and password 6+ chars"}), 400

    exists = db.users.find_one({"username": username}) if use_mongo else any(
        u["username"] == username for u in MEM_STORE["users"]
    )
    if exists:
        return jsonify({"error": "Username already taken"}), 409

    new_user = {
        "username": username,
        "password_hash": generate_password_hash(password),
        "role": "resident",
        "phone": phone
    }
    if use_mongo:
        db.users.insert_one(new_user)
    else:
        MEM_STORE["users"].append({**new_user, "_id": uuid.uuid4().hex[:8]})

    token = serializer.dumps({"username": username, "role": "resident"})
    return jsonify({"token": token, "user": {"username": username, "role": "resident"}}), 201

# --- SENSOR INGESTION & DEMO SIMULATOR ---

@app.post("/api/predict")
def ingest_reading():
    if request.headers.get("X-Node-Key") != NODE_KEY:
        return jsonify({"error": "Invalid sensor API key"}), 401

    data = request.get_json(silent=True) or {}
    try:
        node_id = str(data["node_id"]).strip()
        vals = [float(data[k]) for k in ("voltage", "current", "leakage_ma", "power_factor")]
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "node_id, voltage, current, leakage_ma, and power_factor are required"}), 400

    result = classify_and_store(node_id, *vals)
    return jsonify(result), 201

@app.post("/api/simulate/inject")
@require_roles("safety_officer", "administrator")
def simulate_inject():
    data = request.get_json(silent=True) or {}
    node_id = str(data.get("node_id", "kanyama-01"))
    fault_type = str(data.get("fault_type", "normal"))
    if fault_type not in ("normal", "overload", "earth_fault", "short_circuit", "open_circuit"):
        return jsonify({"error": "Invalid fault_type"}), 400

    rng = np.random.default_rng()
    v, i, leak, pf = generate_sample(fault_type, rng)
    result = classify_and_store(node_id, v, i, leak, pf)
    return jsonify(result), 201

# --- DASHBOARD & WORKFLOW ENDPOINTS ---

@app.get("/api/dashboard")
@require_roles("safety_officer", "administrator")
def get_dashboard():
    if use_mongo:
        nodes = list(db.nodes.find({}, {"_id": 0}))
        readings = list(db.readings.find({}, {"_id": 0}).sort("timestamp", DESCENDING).limit(40))
        alerts = list(db.alerts.find({}, {"_id": 0}).sort("created_at", DESCENDING).limit(30))
        reports = list(db.reports.find({}, {"_id": 0}).sort("created_at", DESCENDING).limit(30))
        sms_logs = list(db.sms_logs.find({}, {"_id": 0}).sort("sent_at", DESCENDING).limit(20))
    else:
        nodes = MEM_STORE["nodes"]
        readings = MEM_STORE["readings"][:40]
        alerts = MEM_STORE["alerts"][:30]
        reports = MEM_STORE["reports"][:30]
        sms_logs = MEM_STORE["sms_logs"][:20]

    return jsonify({
        "nodes": nodes,
        "readings": readings,
        "alerts": alerts,
        "reports": reports,
        "sms_logs": sms_logs,
        "model_metrics": MODEL_METRICS
    })

@app.post("/api/alerts/<alert_id>/acknowledge")
@require_roles("safety_officer", "administrator")
def acknowledge_alert(alert_id):
    ts = now_iso()
    officer = request.user["username"]
    if use_mongo:
        res = db.alerts.update_one(
            {"id": alert_id},
            {"$set": {"status": "acknowledged", "acknowledged_by": officer, "acknowledged_at": ts}}
        )
        if res.matched_count == 0:
            return jsonify({"error": "Alert not found"}), 404
    else:
        alert = next((a for a in MEM_STORE["alerts"] if a["id"] == alert_id), None)
        if not alert:
            return jsonify({"error": "Alert not found"}), 404
        alert.update({"status": "acknowledged", "acknowledged_by": officer, "acknowledged_at": ts})

    return jsonify({"message": "Alert acknowledged", "status": "acknowledged"})

@app.post("/api/alerts/<alert_id>/resolve")
@require_roles("safety_officer", "administrator")
def resolve_alert(alert_id):
    data = request.get_json(silent=True) or {}
    note = str(data.get("note", "Field inspection completed and fault cleared.")).strip()
    ts = now_iso()
    officer = request.user["username"]
    if use_mongo:
        res = db.alerts.update_one(
            {"id": alert_id},
            {"$set": {
                "status": "resolved",
                "resolved_by": officer,
                "resolved_at": ts,
                "resolution_note": note
            }}
        )
        if res.matched_count == 0:
            return jsonify({"error": "Alert not found"}), 404
    else:
        alert = next((a for a in MEM_STORE["alerts"] if a["id"] == alert_id), None)
        if not alert:
            return jsonify({"error": "Alert not found"}), 404
        alert.update({
            "status": "resolved",
            "resolved_by": officer,
            "resolved_at": ts,
            "resolution_note": note
        })

    return jsonify({"message": "Alert resolved", "status": "resolved"})

# --- RESIDENT REPORTS ---

@app.get("/api/reports")
@require_roles("resident", "safety_officer", "administrator")
def list_reports():
    user = request.user
    if use_mongo:
        query = {} if user["role"] in ("safety_officer", "administrator") else {"username": user["username"]}
        reports = list(db.reports.find(query, {"_id": 0}).sort("created_at", DESCENDING).limit(50))
    else:
        if user["role"] in ("safety_officer", "administrator"):
            reports = MEM_STORE["reports"]
        else:
            reports = [r for r in MEM_STORE["reports"] if r["username"] == user["username"]]
    return jsonify({"reports": reports})

@app.post("/api/reports")
@require_roles("resident", "safety_officer", "administrator")
def submit_report():
    data = request.get_json(silent=True) or {}
    compound = str(data.get("compound", "Kanyama")).strip()
    location = str(data.get("location", "")).strip()
    fault_type = str(data.get("fault_type", "")).strip()
    description = str(data.get("description", "")).strip()

    if not location or not fault_type or not description:
        return jsonify({"error": "Location, fault type, and description are required"}), 400

    report_doc = {
        "id": uuid.uuid4().hex[:8],
        "username": request.user["username"],
        "compound": compound,
        "location": location,
        "fault_type": fault_type,
        "description": description,
        "status": "submitted",
        "created_at": now_iso()
    }
    if use_mongo:
        db.reports.insert_one({**report_doc})
    else:
        MEM_STORE["reports"].insert(0, report_doc)

    return jsonify({"report": report_doc}), 201

# --- ADMIN USER MANAGEMENT ---

@app.get("/api/users")
@require_roles("administrator")
def list_users():
    if use_mongo:
        users = list(db.users.find({}, {"_id": 0, "password_hash": 0}))
    else:
        users = [{"username": u["username"], "role": u["role"], "phone": u.get("phone", "")} for u in MEM_STORE["users"]]
    return jsonify({"users": users})

@app.post("/api/users")
@require_roles("administrator")
def create_user():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    role = str(data.get("role", "resident")).strip()
    phone = str(data.get("phone", "")).strip()

    if len(username) < 3 or len(password) < 6:
        return jsonify({"error": "Username 3+ chars and password 6+ chars required"}), 400
    if role not in ("resident", "safety_officer", "administrator"):
        return jsonify({"error": "Invalid role"}), 400

    exists = db.users.find_one({"username": username}) if use_mongo else any(
        u["username"] == username for u in MEM_STORE["users"]
    )
    if exists:
        return jsonify({"error": "Username already exists"}), 409

    user_doc = {
        "username": username,
        "password_hash": generate_password_hash(password),
        "role": role,
        "phone": phone
    }
    if use_mongo:
        db.users.insert_one({**user_doc})
    else:
        MEM_STORE["users"].append({**user_doc, "_id": uuid.uuid4().hex[:8]})

    return jsonify({"user": {"username": username, "role": role, "phone": phone}}), 201

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port)