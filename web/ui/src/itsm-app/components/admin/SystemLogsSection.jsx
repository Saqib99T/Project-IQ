import { useState } from 'react'
import { ScrollText, RefreshCw, AlertTriangle, AlertCircle, XCircle } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { ErrorBanner } from '../../../shared/itsm/primitives'
import { PageHeader, IconButton, Badge, DataTable, FilterBar } from '../../../shared/itsm/ui'

const LEVELS = ['all', 'warning', 'error', 'critical']
const LEVEL_META = {
    warning: { tone: 'amber', icon: AlertTriangle },
    error: { tone: 'red', icon: AlertCircle },
    critical: { tone: 'red', icon: XCircle },
}

function fmt(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

export default function SystemLogsSection() {
    const { get } = useItsmApi()
    const [level, setLevel] = useState('all')
    const { data, loading, error, reload } = useItsmResource(
        () => get('/tenant/system-logs', { ...(level !== 'all' ? { level } : {}), limit: 200 }),
        [get, level]
    )
    const logs = data || []

    const columns = [
        {
            key: 'level', header: 'Level', width: '110px',
            render: (r) => {
                const m = LEVEL_META[r.level] || { tone: 'gray' }
                return <Badge tone={m.tone} icon={m.icon}>{r.level}</Badge>
            },
        },
        { key: 'event', header: 'Event', width: '180px', render: (r) => <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{r.event}</span> },
        { key: 'message', header: 'Message', render: (r) => <span className="text-slate-700 dark:text-slate-300">{r.message}</span> },
        { key: 'exception_type', header: 'Exception', width: '160px', render: (r) => r.exception_type ? <span className="font-mono text-xs text-slate-500">{r.exception_type}</span> : '—' },
        { key: 'created_at', header: 'When', width: '170px', render: (r) => <span className="text-xs text-slate-500 dark:text-slate-400">{fmt(r.created_at)}</span> },
    ]

    return (
        <div className="space-y-4">
            <PageHeader
                title="System Logs"
                subtitle="Warning, error and critical events recorded for this tenant (read-only)."
                icon={ScrollText}
                actions={<IconButton icon={RefreshCw} label="Refresh" onClick={reload} />}
            />
            <FilterBar>
                {LEVELS.map(l => (
                    <button
                        key={l}
                        onClick={() => setLevel(l)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                            level === l
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                        }`}
                    >
                        {l}
                    </button>
                ))}
            </FilterBar>
            {error && <ErrorBanner message={error.message} />}
            <DataTable columns={columns} rows={logs} loading={loading} empty="No system logs recorded." />
        </div>
    )
}
