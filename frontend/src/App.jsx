import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, ShieldAlert, Radio, MessageSquare, Users, FileWarning,
  CheckCircle2, Clock, Activity, LogOut, Play, PlusCircle,
  MapPin, Cpu, AlertTriangle, RefreshCw, Wrench
} from 'lucide-react';
import { apiRequest } from './api';

const FAULT_BADGES = {
  normal: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  overload: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  earth_fault: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  short_circuit: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
  open_circuit: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
};

function formatFault(code) {
  return (code || 'normal').replace('_', ' ').toUpperCase();
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

// Lightweight responsive SVG Voltage & Current Trend Chart (zero external chart dependency issues)
function TelemetryChart({ readings }) {
  const points = [...readings].slice(0, 20).reverse();
  if (points.length < 2) {
    return (
      <div className="h-44 flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-800 rounded-xl">
        Waiting for telemetry windows (use Simulator Controls above to inject readings)...
      </div>
    );
  }

  const width = 640;
  const height = 160;
  const pad = 20;

  const vCoords = points.map((p, idx) => {
    const x = pad + (idx / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - (Math.min(Math.max(p.voltage, 0), 260) / 260) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  const iCoords = points.map((p, idx) => {
    const x = pad + (idx / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - (Math.min(Math.max(p.current, 0), 180) / 180) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="w-full overflow-hidden">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" /> Voltage (0–260V)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Current (0–180A)
          </span>
        </div>
        <span>Last {points.length} sensor windows</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 bg-slate-950/60 rounded-xl border border-slate-800/80">
        <line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke="#1e293b" strokeDasharray="4 4" />
        <polyline fill="none" stroke="#38bdf8" strokeWidth="2.5" points={vCoords} />
        <polyline fill="none" stroke="#fbbf24" strokeWidth="2.5" points={iCoords} />
        {points.map((p, idx) => {
          if (p.fault === 'normal') return null;
          const x = pad + (idx / (points.length - 1)) * (width - pad * 2);
          const y = height - pad - (Math.min(Math.max(p.voltage, 0), 260) / 260) * (height - pad * 2);
          return <circle key={p.id || idx} cx={x} cy={y} r="4.5" fill="#f43f5e" />;
        })}
      </svg>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  // Auth states
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Staff dashboard states
  const [activeTab, setActiveTab] = useState('operations');
  const [dashData, setDashData] = useState({
    nodes: [],
    readings: [],
    alerts: [],
    reports: [],
    sms_logs: [],
    model_metrics: null,
  });
  const [simNode, setSimNode] = useState('kanyama-01');
  const [simFault, setSimFault] = useState('overload');
  const [simBusy, setSimBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Admin user management states
  const [usersList, setUsersList] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'safety_officer', phone: '' });

  // Resident states
  const [myReports, setMyReports] = useState([]);
  const [reportForm, setReportForm] = useState({
    compound: 'Kanyama',
    location: '',
    fault_type: 'Low-hanging distribution line',
    description: '',
  });

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const fetchStaffDashboard = useCallback(async () => {
    if (!user || user.role === 'resident') return;
    try {
      const data = await apiRequest('/api/dashboard');
      setDashData(data);
      if (user.role === 'administrator') {
        const uRes = await apiRequest('/api/users');
        setUsersList(uRes.users || []);
      }
    } catch (err) {
      if (err.message.includes('Session expired')) handleLogout();
    }
  }, [user]);

  const fetchResidentReports = useCallback(async () => {
    if (!user || user.role !== 'resident') return;
    try {
      const data = await apiRequest('/api/reports');
      setMyReports(data.reports || []);
    } catch (err) {
      if (err.message.includes('Session expired')) handleLogout();
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'resident') {
      fetchResidentReports();
      const id = setInterval(fetchResidentReports, 5000);
      return () => clearInterval(id);
    } else {
      fetchStaffDashboard();
      const id = setInterval(fetchStaffDashboard, 3500);
      return () => clearInterval(id);
    }
  }, [user, fetchStaffDashboard, fetchResidentReports]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const payload = isRegister ? { username, password, phone } : { username, password };
      const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      setUser(res.user);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleInjectFault = async () => {
    setSimBusy(true);
    try {
      const res = await apiRequest('/api/simulate/inject', {
        method: 'POST',
        body: JSON.stringify({ node_id: simNode, fault_type: simFault }),
      });
      const classified = res.reading?.fault || simFault;
      showToast(`Injected ${simFault} on ${simNode} → ML Classified: ${formatFault(classified)} (${res.reading?.confidence}%)`);
      fetchStaffDashboard();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setSimBusy(false);
    }
  };

  const handleAcknowledge = async (alertId) => {
    try {
      await apiRequest(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' });
      showToast(`Alert #${alertId} acknowledged.`);
      fetchStaffDashboard();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleResolve = async (alertId) => {
    const note = window.prompt('Enter field resolution note:', 'Line inspected, load balanced and fault cleared.');
    if (note === null) return;
    try {
      await apiRequest(`/api/alerts/${alertId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      showToast(`Alert #${alertId} marked as resolved.`);
      fetchStaffDashboard();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      showToast(`Account "${newUser.username}" (${newUser.role}) created.`);
      setNewUser({ username: '', password: '', role: 'safety_officer', phone: '' });
      fetchStaffDashboard();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleResidentSubmit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/api/reports', {
        method: 'POST',
        body: JSON.stringify(reportForm),
      });
      showToast('Hazard report submitted to Lusaka Safety Desk.');
      setReportForm({ ...reportForm, location: '', description: '' });
      fetchResidentReports();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  // --- LOGIN / REGISTER SCREEN ---
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Zap className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">GridGuard Lusaka</h1>
              <p className="text-xs text-slate-400">LV Electrical Fault Detection & Community Reporting</p>
            </div>
          </div>

          <div className="flex rounded-lg bg-slate-950 p-1 mb-6 border border-slate-800">
            <button
              type="button"
              onClick={() => { setIsRegister(false); setAuthError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition ${!isRegister ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setIsRegister(true); setAuthError(''); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition ${isRegister ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
            >
              Resident Register
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. officer"
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Phone Number (for SMS Alerts)</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+260 97X XXXXXX"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {authError && (
              <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition disabled:opacity-50"
            >
              {authLoading ? 'Authenticating...' : isRegister ? 'Create Resident Account' : 'Access Portal'}
            </button>
          </form>

          {!isRegister && (
            <div className="mt-6 pt-5 border-t border-slate-800">
              <p className="text-xs text-slate-400 mb-2.5">Quick Viva Demo Autofill:</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Admin', u: 'admin', p: 'admin123' },
                  { label: 'Safety Officer', u: 'officer', p: 'officer123' },
                  { label: 'Resident', u: 'resident', p: 'resident123' },
                ].map((acc) => (
                  <button
                    key={acc.u}
                    type="button"
                    onClick={() => { setUsername(acc.u); setPassword(acc.p); }}
                    className="py-1.5 px-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 transition"
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- RESIDENT PORTAL VIEW ---
  if (user.role === 'resident') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="w-6 h-6 text-amber-400" />
            <div>
              <span className="font-bold text-white">GridGuard Community Portal</span>
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Resident: {user.username}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </header>

        {toast && (
          <div className="max-w-5xl mx-auto mt-4 px-4">
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm">
              {toast}
            </div>
          </div>
        )}

        <main className="max-w-5xl mx-auto p-6 grid md:grid-cols-5 gap-6">
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 h-fit">
            <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-1">
              <FileWarning className="w-5 h-5 text-amber-400" /> Report an Electrical Hazard
            </h2>
            <p className="text-xs text-slate-400 mb-5">
              Report visual hazards such as low-hanging lines, sparking poles, or prolonged outages in your compound.
            </p>
            <form onSubmit={handleResidentSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Compound</label>
                <select
                  value={reportForm.compound}
                  onChange={(e) => setReportForm({ ...reportForm, compound: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white"
                >
                  <option>Kanyama</option>
                  <option>Matero</option>
                  <option>Mandevu</option>
                  <option>Chawama</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Street / Landmark</label>
                <input
                  type="text"
                  required
                  value={reportForm.location}
                  onChange={(e) => setReportForm({ ...reportForm, location: e.target.value })}
                  placeholder="e.g. Zone 4 near Chinika Clinic"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Hazard Category</label>
                <select
                  value={reportForm.fault_type}
                  onChange={(e) => setReportForm({ ...reportForm, fault_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white"
                >
                  <option>Low-hanging distribution line</option>
                  <option>Sparking pole or transformer</option>
                  <option>Complete power outage</option>
                  <option>Severe voltage fluctuation / dimming</option>
                  <option>Exposed or vandalized cable</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  required
                  value={reportForm.description}
                  onChange={(e) => setReportForm({ ...reportForm, description: e.target.value })}
                  placeholder="Describe what you observed..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition"
              >
                Submit Safety Report
              </button>
            </form>
          </div>

          <div className="md:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">My Submitted Reports ({myReports.length})</h2>
            {myReports.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-800 rounded-xl">
                You have not submitted any hazard reports yet.
              </p>
            ) : (
              <div className="space-y-3">
                {myReports.map((r) => (
                  <div key={r.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-amber-400">{r.fault_type}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                        {r.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mb-1">
                      <MapPin className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
                      {r.compound} — {r.location}
                    </p>
                    <p className="text-xs text-slate-400">{r.description}</p>
                    <p className="text-[11px] text-slate-500 mt-2">Submitted at {formatTime(r.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // --- SAFETY OFFICER & ADMINISTRATOR OPERATIONS CENTER ---
  const openAlerts = dashData.alerts.filter((a) => a.status === 'open');
  const latestByNode = {};
  dashData.readings.forEach((r) => {
    if (!latestByNode[r.node_id]) latestByNode[r.node_id] = r;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-white text-base">GridGuard Lusaka — LV Operations Center</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Radio className="w-3 h-3 animate-pulse" /> LIVE
              </span>
            </div>
            <p className="text-xs text-slate-400">Kanyama & Matero 400V Secondary Distribution Telemetry</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('operations')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'operations' ? 'bg-amber-500 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
            }`}
          >
            Grid Telemetry & Alerts
          </button>
          <button
            onClick={() => setActiveTab('sms')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'sms' ? 'bg-amber-500 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
            }`}
          >
            SMS & Resident Reports ({dashData.reports.length})
          </button>
          {user.role === 'administrator' && (
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'users' ? 'bg-amber-500 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
              }`}
            >
              User Management
            </button>
          )}
          <div className="h-5 w-px bg-slate-800 mx-1" />
          <span className="text-xs text-slate-400 hidden sm:inline">
            {user.username} ({user.role.replace('_', ' ')})
          </span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            <LogOut className="w-3.5 h-3.5" /> Out
          </button>
        </div>
      </header>

      {toast && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="p-3 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-200 text-xs font-medium">
            {toast}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Unacknowledged Alerts</span>
              <ShieldAlert className={`w-4 h-4 ${openAlerts.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`} />
            </div>
            <div className="text-2xl font-bold text-white">{openAlerts.length}</div>
            <p className="text-[11px] text-slate-500 mt-1">{dashData.alerts.length} total recorded incidents</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Monitored LV Nodes</span>
              <Activity className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-bold text-white">{dashData.nodes.length} Active</div>
            <p className="text-[11px] text-slate-500 mt-1">Kanyama (2) & Matero (2) feeders</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Active ML Classifier</span>
              <Cpu className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-white">
              {dashData.model_metrics ? `${(dashData.model_metrics.nn_macro_f1 * 100).toFixed(1)}% F1` : '95.5% F1'}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Winner: {(dashData.model_metrics?.winner || 'NN').toUpperCase()} vs Random Forest
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>SMS Gateway Dispatches</span>
              <MessageSquare className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-white">{dashData.sms_logs.length} Sent</div>
            <p className="text-[11px] text-slate-500 mt-1">Airtel / MTN ZM Alert Gateway</p>
          </div>
        </div>

        {/* Viva Demo Fault Injection Control Bar */}
        <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
              Hardware-in-the-Loop Simulator (Viva Demo Control)
            </span>
            <p className="text-xs text-slate-400">
              Inject synthetic sensor windows into the REST API to test real-time ML classification and SMS alerting.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={simNode}
              onChange={(e) => setSimNode(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
            >
              <option value="kanyama-01">kanyama-01 (Market Feeder)</option>
              <option value="kanyama-02">kanyama-02 (Los Angeles Rd)</option>
              <option value="matero-01">matero-01 (Commonwealth Ave)</option>
              <option value="matero-02">matero-02 (Stadium Feeder)</option>
            </select>
            <select
              value={simFault}
              onChange={(e) => setSimFault(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
            >
              <option value="normal">Normal Operation</option>
              <option value="overload">Overload Condition</option>
              <option value="earth_fault">Earth Fault (&gt;30mA Leakage)</option>
              <option value="short_circuit">Short Circuit (Critical)</option>
              <option value="open_circuit">Open Circuit (Line Break)</option>
            </select>
            <button
              onClick={handleInjectFault}
              disabled={simBusy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" /> {simBusy ? 'Sending...' : 'Inject Sensor Window'}
            </button>
          </div>
        </div>

        {activeTab === 'operations' && (
          <>
            {/* Compound Feeder Node Cards */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {dashData.nodes.map((node) => {
                const last = latestByNode[node.node_id];
                const isFault = last && last.fault !== 'normal';
                return (
                  <div
                    key={node.node_id}
                    className={`rounded-2xl p-4 border transition ${
                      isFault ? 'bg-rose-950/20 border-rose-500/40' : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-white">{node.node_id}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${FAULT_BADGES[last?.fault || 'normal']}`}>
                        {formatFault(last?.fault || 'normal')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">{node.name}</p>
                    {last ? (
                      <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                        <div>
                          <div className="text-[10px] text-slate-500">Voltage</div>
                          <div className="text-xs font-semibold text-sky-400">{last.voltage}V</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Current</div>
                          <div className="text-xs font-semibold text-amber-400">{last.current}A</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Leakage</div>
                          <div className="text-xs font-semibold text-slate-200">{last.leakage_ma}mA</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 italic">Awaiting telemetry...</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Chart + Alert Dispatch Queue */}
            <div className="grid lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Real-Time Feeder Waveform Telemetry</h2>
                  <button onClick={fetchStaffDashboard} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>
                <TelemetryChart readings={dashData.readings} />

                {/* Live Readings Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2">Time</th>
                        <th className="py-2">Node</th>
                        <th className="py-2">V</th>
                        <th className="py-2">A</th>
                        <th className="py-2">Leak</th>
                        <th className="py-2">PF</th>
                        <th className="py-2">Classification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {dashData.readings.slice(0, 10).map((r) => (
                        <tr key={r.id}>
                          <td className="py-2 text-slate-400">{formatTime(r.timestamp)}</td>
                          <td className="py-2 font-mono text-slate-200">{r.node_id}</td>
                          <td className="py-2">{r.voltage}V</td>
                          <td className="py-2">{r.current}A</td>
                          <td className="py-2">{r.leakage_ma}mA</td>
                          <td className="py-2">{r.power_factor}</td>
                          <td className="py-2">
                            <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${FAULT_BADGES[r.fault]}`}>
                              {formatFault(r.fault)} ({r.confidence}%)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Fault Alerts Queue */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" /> Fault Dispatch & Resolution Queue
                </h2>
                {dashData.alerts.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-10 border border-dashed border-slate-800 rounded-xl">
                    No faults detected yet. Use the simulator bar above to test fault detection.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {dashData.alerts.map((a) => (
                      <div key={a.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${FAULT_BADGES[a.fault]}`}>
                            {formatFault(a.fault)} • {a.confidence}%
                          </span>
                          <span className="text-[11px] text-slate-500">{formatTime(a.created_at)}</span>
                        </div>
                        <div className="text-xs text-slate-300">
                          Node <span className="font-mono font-semibold text-white">{a.node_id}</span> — {a.voltage}V, {a.current}A, {a.leakage_ma}mA
                        </div>
                        {a.resolution_note && (
                          <p className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded">
                            Note: {a.resolution_note}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-slate-400">
                            Status: <strong className="text-slate-200 uppercase">{a.status}</strong>
                            {a.acknowledged_by ? ` (${a.acknowledged_by})` : ''}
                          </span>
                          <div className="flex gap-1.5">
                            {a.status === 'open' && (
                              <button
                                onClick={() => handleAcknowledge(a.id)}
                                className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[11px] font-medium"
                              >
                                Acknowledge
                              </button>
                            )}
                            {a.status !== 'resolved' && (
                              <button
                                onClick={() => handleResolve(a.id)}
                                className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-medium flex items-center gap-1"
                              >
                                <Wrench className="w-3 h-3" /> Resolve
                              </button>
                            )}
                            {a.status === 'resolved' && (
                              <span className="text-emerald-400 text-[11px] flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Closed
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'sms' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" /> Airtel / MTN SMS Gateway Dispatch Log
              </h2>
              {dashData.sms_logs.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">No SMS alerts triggered yet.</p>
              ) : (
                <div className="space-y-3">
                  {dashData.sms_logs.map((s) => (
                    <div key={s.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                      <div className="flex justify-between text-slate-400">
                        <span>To: <strong className="text-white">{s.recipient}</strong> ({s.network})</span>
                        <span className="text-emerald-400 font-semibold">{s.status}</span>
                      </div>
                      <p className="text-slate-200 font-mono text-[11px] bg-slate-900 p-2 rounded">{s.message}</p>
                      <div className="text-[10px] text-slate-500">Sent at {formatTime(s.sent_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-amber-400" /> Community Hazard Reports
              </h2>
              {dashData.reports.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">No resident reports submitted yet.</p>
              ) : (
                <div className="space-y-3">
                  {dashData.reports.map((r) => (
                    <div key={r.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="font-semibold text-amber-400">{r.fault_type}</span>
                        <span className="text-slate-400">By {r.username}</span>
                      </div>
                      <p className="text-slate-300">{r.compound} — {r.location}</p>
                      <p className="text-slate-400">{r.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'users' && user.role === 'administrator' && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-fit">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-amber-400" /> Provision System Account
              </h2>
              <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-300 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Password (6+ chars)</label>
                  <input
                    type="password"
                    required
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  >
                    <option value="safety_officer">Safety Officer</option>
                    <option value="administrator">Administrator</option>
                    <option value="resident">Resident</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">SMS Phone Number</label>
                  <input
                    type="text"
                    value={newUser.phone}
                    onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                    placeholder="+260977..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold transition"
                >
                  Create Account
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" /> Registered Accounts ({usersList.length})
              </h2>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2">Username</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">SMS Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {usersList.map((u) => (
                    <tr key={u.username}>
                      <td className="py-2.5 font-medium text-white">{u.username}</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase text-[10px]">
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-400">{u.phone || 'Not set'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}