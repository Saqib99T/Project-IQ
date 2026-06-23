import { useState, useEffect } from 'react'
import { useApi } from '../useApi'

const MATCH_TYPES = ['intent', 'keyword', 'app_id', 'entity', 'regex']
const MATCH_LABELS = {
    intent:  'Intent',
    keyword: 'Keyword',
    app_id:  'App ID',
    entity:  'Entity',
    regex:   'Regex',
}

const EMPTY_RULE = {
    id: null,
    match_type: 'intent',
    match_value: '',
    target_queue: '',
    priority_boost: 0,
    description: '',
    enabled: true,
}

function RuleModal({ rule, queues, onSave, onClose }) {
    const [form, setForm] = useState({ ...EMPTY_RULE, ...rule })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const { call } = useApi()

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

    const handleSave = async () => {
        if (!form.match_value.trim()) { setError('Match value is required'); return }
        setSaving(true)
        setError(null)
        try {
            const body = {
                match_type:    form.match_type,
                match_value:   form.match_value.trim(),
                target_queue:  form.target_queue || null,
                priority_boost: Number(form.priority_boost) || 0,
                description:   form.description.trim(),
                enabled:       form.enabled,
            }
            if (form.id) {
                await call(`/admin/handoff/routing/${form.id}`, { method: 'PUT', body: JSON.stringify(body) })
            } else {
                await call('/admin/handoff/routing', { method: 'POST', body: JSON.stringify(body) })
            }
            onSave()
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
                    <h3 className="font-semibold text-gray-900 dark:text-slate-100">{form.id ? 'Edit Rule' : 'New Routing Rule'}</h3>
                    <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 hover:dark:text-slate-400 text-2xl leading-none">×</button>
                </div>

                <div className="p-5 space-y-4">
                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="form-label">Match type</label>
                            <select value={form.match_type} onChange={e => set('match_type', e.target.value)}
                                className="form-input w-full">
                                {MATCH_TYPES.map(t => <option key={t} value={t}>{MATCH_LABELS[t]}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="form-label">Match value</label>
                            <input value={form.match_value} onChange={e => set('match_value', e.target.value)}
                                placeholder={form.match_type === 'intent' ? 'greet' : form.match_type === 'keyword' ? 'urgent' : ''}
                                className="form-input w-full" />
                        </div>
                    </div>

                    <div>
                        <label className="form-label">Target queue <span className="text-gray-400 dark:text-slate-500 font-normal">(optional)</span></label>
                        {queues.length > 0 ? (
                            <select value={form.target_queue} onChange={e => set('target_queue', e.target.value)}
                                className="form-input w-full">
                                <option value="">— none —</option>
                                {queues.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
                            </select>
                        ) : (
                            <input value={form.target_queue} onChange={e => set('target_queue', e.target.value)}
                                placeholder="queue-id or name"
                                className="form-input w-full" />
                        )}
                    </div>

                    <div>
                        <label className="form-label">Priority boost <span className="text-gray-400 dark:text-slate-500 font-normal">(0 = normal, higher = sooner)</span></label>
                        <input type="number" min={0} max={100} value={form.priority_boost}
                            onChange={e => set('priority_boost', e.target.value)}
                            className="form-input w-32" />
                    </div>

                    <div>
                        <label className="form-label">Description</label>
                        <input value={form.description} onChange={e => set('description', e.target.value)}
                            placeholder="What this rule does…"
                            className="form-input w-full" />
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.enabled}
                            onChange={e => set('enabled', e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm text-gray-700 dark:text-slate-300">Enabled</span>
                    </label>
                </div>

                <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 rounded-b-2xl">
                    <button onClick={onClose} className="btn-ghost">Cancel</button>
                    <button onClick={handleSave} disabled={saving} className="btn-primary">
                        {saving ? 'Saving…' : 'Save rule'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default function RoutingRulesPage() {
    const { call } = useApi()
    const [rules, setRules]   = useState([])
    const [queues, setQueues] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError]   = useState(null)
    const [modal, setModal]   = useState(null) // null | 'new' | rule-object
    const [autoAssign, setAutoAssign] = useState(false)
    const [savingAuto, setSavingAuto] = useState(false)

    const fetchAll = async () => {
        setLoading(true)
        setError(null)
        try {
            const [rulesData, queuesData, cfgData] = await Promise.allSettled([
                call('/admin/handoff/routing'),
                call('/admin/handoff/queues'),
                call('/admin/handoff/config'),
            ])
            setRules(rulesData.status === 'fulfilled' ? (rulesData.value?.rules || rulesData.value || []) : [])
            setQueues(queuesData.status === 'fulfilled' ? (queuesData.value?.queues || queuesData.value || []) : [])
            if (cfgData.status === 'fulfilled')
                setAutoAssign(!!cfgData.value?.config?.operators?.auto_assign)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    const toggleAutoAssign = async () => {
        const next = !autoAssign
        setSavingAuto(true)
        setError(null)
        try {
            await call('/admin/handoff/config', {
                method: 'PUT',
                body: JSON.stringify({ operators: { auto_assign: next } }),
            })
            setAutoAssign(next)
        } catch (e) {
            setError(e.message)
        } finally {
            setSavingAuto(false)
        }
    }

    useEffect(() => { fetchAll() }, [])

    const handleToggle = async (rule) => {
        try {
            await call(`/admin/handoff/routing/${rule.id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
            })
            fetchAll()
        } catch (e) {
            setError(e.message)
        }
    }

    const handleDelete = async (ruleId) => {
        if (!window.confirm('Delete this routing rule?')) return
        try {
            await call(`/admin/handoff/routing/${ruleId}`, { method: 'DELETE' })
            fetchAll()
        } catch (e) {
            setError(e.message)
        }
    }

    const handleSaved = () => { setModal(null); fetchAll() }

    return (
        <div className="max-w-4xl space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Routing Rules</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Control how conversations are routed to queues</p>
                </div>
                <button onClick={() => setModal('new')} className="btn-primary">+ New Rule</button>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            <div className="card p-4 flex items-center justify-between">
                <div className="pr-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Auto-assign to least-loaded operator</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        When on, a new handoff is handed straight to the available operator with the fewest active chats
                        (respecting team, capacity and shift) instead of waiting for a manual claim. When off, items stay in the queue.
                    </p>
                </div>
                <button onClick={toggleAutoAssign} disabled={savingAuto}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${autoAssign ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'}`}>
                    <span className={`inline-block w-4 h-4 rounded-full bg-white dark:bg-slate-900 shadow transform transition-transform m-0.5 ${autoAssign ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
            </div>

            <div className="card overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                        <tr>
                            <th className="px-4 py-3 text-left">Match</th>
                            <th className="px-4 py-3 text-left">Value</th>
                            <th className="px-4 py-3 text-left">Target queue</th>
                            <th className="px-4 py-3 text-right">Priority</th>
                            <th className="px-4 py-3 text-left">Description</th>
                            <th className="px-4 py-3 text-center">Status</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                        {loading && (
                            <tr><td colSpan={7} className="px-4 py-10 text-center">
                                <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                            </td></tr>
                        )}
                        {!loading && rules.map(rule => (
                            <tr key={rule.id} className={`hover:bg-gray-50 hover:dark:bg-slate-800/60 ${!rule.enabled ? 'opacity-50' : ''}`}>
                                <td className="px-4 py-3">
                                    <span className="badge bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400">{MATCH_LABELS[rule.match_type] || rule.match_type}</span>
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">{rule.match_value}</td>
                                <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{rule.target_queue || <span className="text-gray-400 dark:text-slate-500">—</span>}</td>
                                <td className="px-4 py-3 text-right">
                                    {rule.priority_boost > 0
                                        ? <span className="badge bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">+{rule.priority_boost}</span>
                                        : <span className="text-gray-400 dark:text-slate-500">0</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">{rule.description || '—'}</td>
                                <td className="px-4 py-3 text-center">
                                    <button onClick={() => handleToggle(rule)}
                                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${rule.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'}`}>
                                        <span className={`inline-block w-4 h-4 rounded-full bg-white dark:bg-slate-900 shadow transform transition-transform m-0.5 ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button onClick={() => setModal(rule)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline mr-3">Edit</button>
                                    <button onClick={() => handleDelete(rule.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!loading && rules.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 dark:text-slate-500">
                                No routing rules yet — create one to get started
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Info card */}
            <div className="card p-4 bg-blue-50 dark:bg-blue-500/10 border-blue-100">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                    <strong>How rules work:</strong> When a conversation matches a rule, it is routed to the specified queue and its priority is boosted.
                    Rules are evaluated in order of priority boost (highest first). If no rule matches, the default queue is used.
                    <br /><strong>Match types:</strong> Intent = ML Core intent name · Keyword = message text contains · App ID = exact app ID · Entity = any entity with this name · Regex = pattern match on message text.
                </p>
            </div>

            {modal && (
                <RuleModal
                    rule={modal === 'new' ? EMPTY_RULE : modal}
                    queues={queues}
                    onSave={handleSaved}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    )
}
