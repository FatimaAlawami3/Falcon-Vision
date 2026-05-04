import { useEffect, useMemo, useState } from 'react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { getAccessToken } from '../../lib/auth';
import { listAlerts, resolveStorageUrl, type AlertResponse } from '../../lib/api';

function getAlertType(alert: AlertResponse) {
  const message = alert.message.toLowerCase();

  if (alert.category === 'fire_smoke') {
    if (message.includes('smoke')) {
      return 'Smoke Alert';
    }
    if (message.includes('fire')) {
      return 'Fire Alert';
    }
    return 'Fire / Smoke Alert';
  }

  if (alert.category === 'fall') {
    return 'Fall Alert';
  }

  if (alert.category === 'ppe') {
    return 'PPE Violation';
  }

  if (alert.category === 'access_control') {
    if (message.includes('no face gallery')) {
      return 'Face Setup Alert';
    }
    return 'Access Alert';
  }

  return alert.category.replace(/_/g, ' ');
}

function getAlertGroup(alert: AlertResponse) {
  const type = getAlertType(alert);

  if (type === 'Fire Alert' || type === 'Smoke Alert' || type === 'Fire / Smoke Alert' || type === 'Fall Alert') {
    return 'Critical Alerts';
  }

  if (type === 'PPE Violation') {
    return 'PPE Violations';
  }

  return 'Other Alerts';
}

export function AdminAlertsHistoryPage() {
  const [dateFilter, setDateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [alerts, setAlerts] = useState<AlertResponse[]>([]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    void listAlerts(token).then((response) => {
      setAlerts(response.items);
    }).catch(() => {
      setAlerts([]);
    });
  }, []);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      const date = new Date(alert.detected_at).toLocaleDateString('en-CA');
      const matchesDate = dateFilter ? date === dateFilter : true;
      const matchesType = typeFilter === 'All' ? true : getAlertType(alert) === typeFilter;
      return matchesDate && matchesType;
    });
  }, [alerts, dateFilter, typeFilter]);

  const violationData = useMemo(() => {
    const counts = new Map<string, number>();
    alerts.forEach((alert) => {
      const key = getAlertType(alert);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  }, [alerts]);

  const timelineData = useMemo(() => {
    const counts = new Map<string, number>();
    alerts.forEach((alert) => {
      const date = new Date(alert.detected_at).toLocaleDateString('en-CA');
      counts.set(date, (counts.get(date) ?? 0) + 1);
    });
    return Array.from(counts.entries()).map(([date, violations]) => ({ date, violations }));
  }, [alerts]);

  const totalAlerts = violationData.reduce((sum, item) => sum + item.count, 0);
  const alertTypes = Array.from(new Set(alerts.map((alert) => getAlertType(alert))));
  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={true} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Admin - Alerts History</h1>

          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
              <h2 className="font-serif text-xl text-[#4a3c2a] mb-4">Total Alerts by Type</h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={violationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d4cbb7" />
                  <XAxis dataKey="name" stroke="#6b5d4f" />
                  <YAxis stroke="#6b5d4f" />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ff8c42" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7] flex flex-col items-center justify-center">
              <h2 className="font-serif text-xl text-[#4a3c2a] mb-4">Total Alerts</h2>
              <div className="text-6xl font-serif text-[#ff8c42]">{totalAlerts}</div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
              <h2 className="font-serif text-xl text-[#4a3c2a] mb-4">Alerts Over Time</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d4cbb7" />
                  <XAxis dataKey="date" stroke="#6b5d4f" />
                  <YAxis stroke="#6b5d4f" />
                  <Tooltip />
                  <Line type="monotone" dataKey="violations" stroke="#ff8c42" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7] mb-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[#6b5d4f] mb-2">Search by Date</label>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] focus:outline-none focus:border-[#ff8c42]"
                />
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Alert Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] focus:outline-none focus:border-[#ff8c42]"
                >
                  <option>All</option>
                  {alertTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
            <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Alert Records</h2>
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full">
                <thead className="border-b-2 border-[#d4cbb7]">
                  <tr>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Date</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Time</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Detected Image</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Alert Type</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAlerts.length > 0 ? (
                    filteredAlerts.map((alert) => {
                      const detectedAt = new Date(alert.detected_at);
                      const imageUrl = resolveStorageUrl(alert.evidence_image_path);
                      return (
                        <tr key={alert.id} className="border-b border-[#d4cbb7]/50 hover:bg-[#f5f3ed] transition-colors">
                          <td className="py-3 px-4 text-[#4a3c2a]">{detectedAt.toLocaleDateString('en-CA')}</td>
                          <td className="py-3 px-4 text-[#6b5d4f]">{detectedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="py-3 px-4">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt={alert.message}
                                className="w-20 h-20 rounded-2xl object-cover border border-[#d4cbb7] shadow-sm"
                              />
                            ) : (
                              <span className="text-sm text-[#8b7355]">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#4a3c2a]">
                            <span className={`inline-block px-3 py-1 rounded-full text-xs ${
                              getAlertGroup(alert) === 'Critical Alerts'
                                ? 'bg-red-100 text-red-700'
                                : getAlertGroup(alert) === 'PPE Violations'
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-slate-100 text-slate-700'
                            }`}>
                              {getAlertType(alert)}
                            </span>
                            <p className="text-sm text-[#6b5d4f] mt-1">{alert.message}</p>
                          </td>
                          <td className="py-3 px-4 text-[#6b5d4f]">{alert.zone_name ?? '-'}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-[#6b5d4f]">
                        No alerts found for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
