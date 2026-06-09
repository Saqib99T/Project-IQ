import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'
import { useConfirm } from '../../../shared/itsm/ui'
import NewAutomationRuleModal from './NewAutomationRuleModal'

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

function RuleLogsTab({ ruleId, get }) {
    const { data, loading, error } = useItsmResource(() => get(`/automation/rules/${ruleId}/logs`), [get, ruleId])
    const logs = data?.items || []

    if (loading) return <LoadingSpinner />
    if (error) return <ErrorBanner message={error.message} />
    if (logs.length === 0) return <EmptyState>This rule hasn't fired yet.</EmptyState>

    return (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {logs.map(log => (
                <div key={log.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{log.entity_type} · {log.entity_id}</span>
                        <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(log.created_at)}</span>
                    </div>
                    {log.error
                        ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {log.error}</p>
                        : <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{log.actions_executed?.length || 0} action(s) executed</p>}
                </div>
            ))}
        </div>
    )
}

function RuleTestTab({ ruleId, post }) {
    const [entityType, setEntityType] = useState('ticket')
    const [entityId, setEntityId] = useState('')
    const [result, setResult] = useState(null)
    const [running, setRunning] = useState(false)
    const [error, setError] = useState(null)

    const run = async (e) => {
        e.preventDefault()
        setRunning(true); setError(null); setResult(null)
        try {
            const res = await post(`/automation/rules/${ruleId}/test`, { entity_type: entityType, entity_id: entityId.trim() })
            setResult(res)
        } catch (err) { setError(err) } finally { setRunning(false) }
    }

    return (
        <div className="space-y-3">
            <form onSubmit={run} className="flex items-end gap-2">
                <FormField label="Entity type">
                    <select className="input" value={entityType} onChange={e => setEntityType(e.target.value)}>
                        <option value="ticket">Ticket</option>
                        <option value="asset">Asset</option>
                    </select>
                </FormField>
                <FormField label="Entity ID">
                    <input className="input font-mono text-xs" required value={entityId} onChange={e => setEntityId(e.target.value)} placeholder="UUID" />
                </FormField>
                <button type="submit" disabled={running || !entityId.trim()} className="btn-primary text-xs py-2">
                    {running ? 'Testing…' : 'Run test'}
                </button>
            </form>
            {error && <ErrorBanner message={error.message} />}
            {result && (
                <div className="space-y-2 text-sm">
                    <p className={result.conditions_pass ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}>
                        {result.conditions_pass ? '✓ Conditions match — actions would run' : '✕ Conditions do not match'}
                    </p>
                    <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Condition results</p>
                        <pre className="text-xs bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5 overflow-x-auto">{JSON.stringify(result.condition_results, null, 2)}</pre>
                    </div>
                    {result.conditions_pass && (
                        <div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Actions that would execute</p>
                            <pre className="text-xs bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5 overflow-x-auto">{JSON.stringify(result.actions_would_execute, null, 2)}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function RuleActivityModal({ rule, onClose }) {
    const { get, post } = useItsmApi()
    const [tab, setTab] = useState('logs')

    return (
        <Modal open={!!rule} onClose={onClose} title={rule ? `Activity — ${rule.name}` : ''} maxWidth="max-w-2xl">
            <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                    {[{ id: 'logs', label: 'Execution log' }, { id: 'test', label: 'Test rule' }].map(t => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                tab === t.id ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                {rule && (tab === 'logs' ? <RuleLogsTab ruleId={rule.id} get={get} /> : <RuleTestTab ruleId={rule.id} post={post} />)}
            </div>
        </Modal>
    )
}

export default function AutomationRulesSection() {
    const { get, patch, remove } = useItsmApi()
    const confirm = useConfirm()
    const [showNew, setShowNew] = useState(false)
    const [activityRule, setActivityRule] = useState(null)
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data, loading, reload } = useItsmResource(() => get('/automation/rules'), [get])
    const rules = data?.items || []

    const toggleActive = async (rule) => {
        setBusyId(rule.id); setError(null)
        try {
            await patch(`/automation/rules/${rule.id}`, { is_active: !rule.is_active })
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }

    const del = async (rule) => {
        if (!(await confirm({ title: 'Delete rule?', message: `Delete automation rule "${rule.name}"?`, danger: true, confirmLabel: 'Delete' }))) return
        setBusyId(rule.id); setError(null)
        try {
            await remove(`/automation/rules/${rule.id}`)
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Automation rules</h3>
                <button onClick={() => setShowNew(true)} className="btn-primary text-xs">+ New rule</button>
            </div>

            <NewAutomationRuleModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />
            <RuleActivityModal rule={activityRule} onClose={() => setActivityRule(null)} />

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                rules.length === 0
                    ? <EmptyState>No automation rules configured.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {rules.map(r => (
                                <li key={r.id} className="flex items-center justify-between gap-3 text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300 truncate">{r.name}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">
                                            {r.trigger} · order {r.run_order} · triggered {r.trigger_count}×
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <button onClick={() => setActivityRule(r)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Activity</button>
                                        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                            <input type="checkbox" checked={r.is_active} disabled={busyId === r.id} onChange={() => toggleActive(r)} />
                                            Active
                                        </label>
                                        <button onClick={() => del(r)} disabled={busyId === r.id} className="text-xs text-red-600 dark:text-red-400 hover:underline">Delete</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
