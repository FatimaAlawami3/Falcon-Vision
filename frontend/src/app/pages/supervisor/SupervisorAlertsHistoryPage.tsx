import { useEffect, useMemo, useState } from 'react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { getAccessToken } from '../../lib/auth';
import { listAlerts, resolveStorageUrl, type AlertResponse } from '../../lib/api';

export function SupervisorAlertsHistoryPage() {
  const [dateFilter, setDateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [alerts, setAlerts] = useState<AlertResponse[]>([]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      return;
    }

    void listAlerts(token, 100).then((response) => {
      setAlerts(response.items);
    }).catch(() => {
      setAlerts([]);
    });
  }, []);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      const date = new Date(alert.detected_at).toLocaleDateString('en-CA');
      const matchesDate = dateFilter ? date === dateFilter : true;
      const matchesType = typeFilter === 'All' ? true : alert.message === typeFilter;
      return matchesDate && matchesType;
    });
  }, [alerts, dateFilter, typeFilter]);

  const violationData = useMemo(() => {
    const counts = new Map<string, number>();
    alerts.forEach((alert) => {
      const key = alert.category.replace(/_/g, ' ');
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

  const totalViolations = violationData.reduce((sum, item) => sum + item.count, 0);
  const violationTypes = Array.from(new Set(alerts.map((alert) => alert.message)));

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={false} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Supervisor - Alerts History</h1>

          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
              <h2 className="font-serif text-xl text-[#4a3c2a] mb-4">Total Violations by Type</h2>
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
              <h2 className="font-serif text-xl text-[#4a3c2a] mb-4">Total Number of Violations</h2>
              <div className="text-6xl font-serif text-[#ff8c42]">{totalViolations}</div>
            </div>

            <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
              <h2 className="font-serif text-xl text-[#4a3c2a] mb-4">Violations Over Time</h2>
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
                <label className="block text-[#6b5d4f] mb-2">Violation Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] focus:outline-none focus:border-[#ff8c42]"
                >
                  <option>All</option>
                  {violationTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7]">
            <h2 className="font-serif text-2xl text-[#4a3c2a] mb-6">Violation Records</h2>
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="border-b-2 border-[#d4cbb7]">
                  <tr>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Date</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Time</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Detected Image</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Violation Type</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Location</th>
                    <th className="text-left py-3 px-4 text-[#6b5d4f]">Severity</th>
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
                              <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-red-500">
                                <img src={imageUrl} alt={alert.message} className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-12 h-12 bg-[#ff8c42]/20 rounded-lg flex items-center justify-center text-xs text-[#ff8c42] text-center px-2">
                                Alert
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[#4a3c2a]">{alert.message}</td>
                          <td className="py-3 px-4 text-[#6b5d4f]">{alert.zone_name ?? '-'}</td>
                          <td className="py-3 px-4">
                            <span className={`px-3 py-1 rounded-full text-sm ${
                              alert.severity === 'critical' ? 'bg-red-100 text-red-700' :
                              alert.severity === 'high' ? 'bg-orange-100 text-orange-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                              {alert.severity}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[#6b5d4f]">
                        No violations found for the selected filters.
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
