import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'
import { usePortalSocket } from '../operator/usePortalSocket'

const STATUS_STYLE = {
    available: 'bg-green-100 text-green-700',
    busy:      'bg-amber-100 text-amber-700',
    away:      'bg-gray-100 text-gray-500',
    offline:   'bg-gray-100 text-gray-400',
}

function timeAgo(iso) {
    if (!iso) return 'Never'
    const secs = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (secs < 60)   return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
}

export default function OperatorsPage() {
    const { call } = useApi()
    const [operators, setOperators] = useState([])
    const [loading, setLoading]     = useState(true)
    const [error, setError]         = useState(null)

    const fetchOperators = useCallback(async () => {
        try {
            const data = await call('/portal/api/admin/operators')
            setOperators(data.operators || [])
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call])

    useEffect(() => { fetchOperators() }, [fetchOperators])

    // Refresh on capacity changes
    usePortalSocket({ onEvent: (evt) => {
        if (evt === 'capacity_update') fetchOperators()
    }})

    const online  = operators.filter(o => o.status !== 'offline')
    const offline = operators.filter(o => o.status === 'offline')

    return (
        <div className="max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Operators</h2>
                    <p className="text-sm text-gray-500">
                        {online.length} online · {operators.length} total
                    </p>
                </div>
                <button onClick={fetchOperators} className="btn-ghost text-xs">↻ Refresh</button>
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
                                <th className="px-5 py-3 text-left">Operator</th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-right">Active</th>
                                <th className="px-5 py-3 text-right">Max</th>
                                <th className="px-5 py-3 text-left">Last seen</th>
                                <th className="px-5 py-3 text-left">Org</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {[...online, ...offline].map(op => (
                                <tr key={op.id} className={`hover:bg-gray-50 ${op.status === 'offline' ? 'opacity-50' : ''}`}>
                                    <td className="px-5 py-3">
                                        <div className="font-medium text-gray-900">{op.display_name}</div>
                                        <div className="text-xs text-gray-400">{op.email}</div>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={`badge ${STATUS_STYLE[op.status] || 'bg-gray-100 text-gray-500'}`}>
                                            {op.status}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-medium">
                                        {op.active_sessions ?? 0}
                                    </td>
                                    <td className="px-5 py-3 text-right text-gray-500">
                                        {op.max_concurrent}
                                    </td>
                                    <td className="px-5 py-3 text-gray-500 text-xs">
                                        {timeAgo(op.last_seen)}
                                    </td>
                                    <td className="px-5 py-3 text-gray-500 text-xs">
                                        {op.org_id || '—'}
                                    </td>
                                </tr>
                            ))}

                            {operators.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                                        No operators found
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
