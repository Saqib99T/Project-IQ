import { useState, useEffect } from 'react'
import { useApi } from '../useApi'

function timeAgo(iso) {
    if (!iso) return '—'
    const secs = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (secs < 60)    return `${secs}s ago`
    if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
}

export default function OrgsPage() {
    const { call } = useApi()
    const [orgs, setOrgs]       = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState(null)

    useEffect(() => {
        call('/portal/api/admin/orgs')
            .then(d => { setOrgs(d.orgs || []); setError(null) })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call])

    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Organisations</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                    Client orgs active in the platform — {orgs.length} found
                </p>
            </div>

            {loading && (
                <div className="flex justify-center py-16">
                    <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
            )}

            {!loading && !error && (
                <div className="card overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                            <tr>
                                <th className="px-5 py-3 text-left">Org ID</th>
                                <th className="px-5 py-3 text-right">Waiting</th>
                                <th className="px-5 py-3 text-right">Assigned</th>
                                <th className="px-5 py-3 text-right">Resolved (7d)</th>
                                <th className="px-5 py-3 text-right">Total</th>
                                <th className="px-5 py-3 text-left">Last activity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {orgs.map(o => (
                                <tr key={o.org_id} className="hover:bg-gray-50">
                                    <td className="px-5 py-3 font-medium text-gray-900">{o.org_id}</td>
                                    <td className="px-5 py-3 text-right">
                                        {o.waiting > 0
                                            ? <span className="text-amber-600 font-medium">{o.waiting}</span>
                                            : <span className="text-gray-400">0</span>}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        {o.assigned > 0
                                            ? <span className="text-green-600 font-medium">{o.assigned}</span>
                                            : <span className="text-gray-400">0</span>}
                                    </td>
                                    <td className="px-5 py-3 text-right text-blue-600">{o.resolved_7d ?? 0}</td>
                                    <td className="px-5 py-3 text-right text-gray-500">{o.resolved_total ?? 0}</td>
                                    <td className="px-5 py-3 text-xs text-gray-400">{timeAgo(o.last_activity)}</td>
                                </tr>
                            ))}

                            {orgs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                                        No organisation data yet
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
