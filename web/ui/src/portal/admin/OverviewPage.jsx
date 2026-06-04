import { useState, useEffect } from 'react'
import { useApi } from '../useApi'

function StatCard({ label, value, sub, color = 'blue' }) {
    const colors = {
        blue:   'bg-blue-50 text-blue-700 border-blue-200',
        green:  'bg-green-50 text-green-700 border-green-200',
        amber:  'bg-amber-50 text-amber-700 border-amber-200',
        red:    'bg-red-50 text-red-700 border-red-200',
        gray:   'bg-gray-50 text-gray-700 border-gray-200',
    }
    return (
        <div className={`card p-5 border ${colors[color]}`}>
            <p className="text-sm font-medium opacity-75">{label}</p>
            <p className="text-3xl font-bold mt-1">{value ?? '—'}</p>
            {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
        </div>
    )
}

export default function OverviewPage() {
    const { call } = useApi()
    const [stats, setStats]   = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError]   = useState(null)

    useEffect(() => {
        call('/portal/api/stats')
            .then(d => setStats(d))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call])

    if (loading) return (
        <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )

    if (error) return (
        <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
    )

    return (
        <div className="space-y-6 max-w-4xl">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Overview</h2>
                <p className="text-sm text-gray-500 mt-0.5">Live system snapshot</p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Waiting"         value={stats?.waiting_count}   color="amber" />
                <StatCard label="Active sessions" value={stats?.assigned_count}  color="green" />
                <StatCard label="Operators online" value={stats?.operators_online} color="blue" />
                <StatCard label="Today's resolved" value={stats?.resolved_today}  color="gray" />
            </div>

            {stats?.orgs && stats.orgs.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100">
                        <h3 className="font-semibold text-gray-800">Active Organisations</h3>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                            <tr>
                                <th className="px-5 py-3 text-left">Org</th>
                                <th className="px-5 py-3 text-right">Waiting</th>
                                <th className="px-5 py-3 text-right">Assigned</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {stats.orgs.map(o => (
                                <tr key={o.org_id} className="hover:bg-gray-50">
                                    <td className="px-5 py-3 font-medium text-gray-900">{o.org_name || o.org_id}</td>
                                    <td className="px-5 py-3 text-right text-amber-600">{o.waiting}</td>
                                    <td className="px-5 py-3 text-right text-green-600">{o.assigned}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
