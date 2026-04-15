import { useState } from 'react';
import { Navigation } from '../../components/Navigation';
import { Footer } from '../../components/Footer';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Search } from 'lucide-react';
import workerDetectedImage from '../../../assets/images/worker-detected.png';

export function AdminAlertsHistoryPage() {
  const [dateFilter, setDateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');

  const violationData = [
    { name: 'PPE', count: 45 },
    { name: 'Face Rec', count: 12 },
    { name: 'Thermal', count: 8 },
    { name: 'Fall', count: 3 }
  ];

  // Calculate total violations
  const totalViolations = violationData.reduce((sum, item) => sum + item.count, 0);

  const timelineData = [
    { date: 'Aug', violations: 42 },
    { date: 'Sep', violations: 55 },
    { date: 'Oct', violations: 48 },
    { date: 'Nov', violations: 61 },
    { date: 'Dec', violations: 53 },
    { date: 'Jan', violations: 68 }
  ];
  const violations = [
    { date: '2026-01-07', time: '14:30', type: 'PPE Missing', location: 'Zone A', severity: 'High' },
    { date: '2026-01-07', time: '12:15', type: 'Unauthorized Access', location: 'Zone C', severity: 'Medium' },
    { date: '2026-01-07', time: '10:45', type: 'High Temperature', location: 'Boiler Room', severity: 'High' },
    { date: '2026-01-06', time: '16:20', type: 'PPE Missing', location: 'Zone B', severity: 'High' },
    { date: '2026-01-06', time: '14:10', type: 'Fall Detected', location: 'Zone A', severity: 'Critical' },
    { date: '2026-01-06', time: '09:30', type: 'PPE Missing', location: 'Zone A', severity: 'High' }
  ];

  const filteredViolations = violations.filter(violation => {
    const matchesDate = dateFilter ? violation.date === dateFilter : true;
    const matchesType = typeFilter === 'All' ? true : violation.type === typeFilter;
    return matchesDate && matchesType;
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f3ed]">
      <Navigation isAdmin={true} />

      <div className="flex-1 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="font-serif text-4xl text-[#4a3c2a] mb-8">Admin – Alerts History</h1>

          {/* Charts */}
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

            {/* Total Number of Violations Card */}
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

          {/* Filters */}
          <div className="bg-white rounded-3xl shadow-xl p-6 border border-[#d4cbb7] mb-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[#6b5d4f] mb-2">Search by Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] focus:outline-none focus:border-[#ff8c42]"
                  />
                  {/* Search icon removed to prevent overlap with date picker */}
                </div>
              </div>

              <div>
                <label className="block text-[#6b5d4f] mb-2">Violation Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#d4cbb7] focus:outline-none focus:border-[#ff8c42]"
                >
                  <option>All</option>
                  <option>PPE Missing</option>
                  <option>Unauthorized Access</option>
                  <option>High Temperature</option>
                  <option>Fall Detected</option>
                </select>
              </div>
            </div>
          </div>

          {/* Violations Table */}
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
                  {filteredViolations.length > 0 ? (
                    filteredViolations.map((violation, index) => (
                      <tr key={index} className="border-b border-[#d4cbb7]/50 hover:bg-[#f5f3ed] transition-colors">
                        <td className="py-3 px-4 text-[#4a3c2a]">{violation.date}</td>
                        <td className="py-3 px-4 text-[#6b5d4f]">{violation.time}</td>
                        <td className="py-3 px-4">
                          {violation.type === 'PPE Missing' && violation.location === 'Zone A' ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-red-500">
                              <img
                                src={workerDetectedImage}
                                alt="Detected Worker"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-12 h-12 bg-[#ff8c42]/20 rounded-lg flex items-center justify-center text-xs text-[#ff8c42]">
                              Worker
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#4a3c2a]">{violation.type}</td>
                        <td className="py-3 px-4 text-[#6b5d4f]">{violation.location}</td>
                        <td className="py-3 px-4">
                          <span className={`px-3 py-1 rounded-full text-sm ${violation.severity === 'Critical' ? 'bg-red-100 text-red-700' :
                            violation.severity === 'High' ? 'bg-orange-100 text-orange-700' :
                              'bg-yellow-100 text-yellow-700'
                            }`}>
                            {violation.severity}
                          </span>
                        </td>
                      </tr>
                    ))
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