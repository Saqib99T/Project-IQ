import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

function MessageBubble({ msg }) {
    const isBot = msg.sender !== 'user' && !msg.is_user
    return (
        <div className={`flex ${isBot ? 'justify-start' : 'justify-end'} mb-2`}>
            <div className={`max-w-xs rounded-xl px-3 py-2 text-xs ${
                isBot ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-slate-100' : 'bg-blue-600 text-white'
            }`}>
                <p>{msg.text || msg.data?.text || JSON.stringify(msg.data || msg)}</p>
                {msg.timestamp && <p className="mt-1 opacity-50 text-xs">{new Date(msg.timestamp * 1000).toLocaleTimeString()}</p>}
            </div>
        </div>
    )
}

function IntentBadge({ intent, confidence }) {
    const pct = confidence != null ? Math.round(confidence * 100) : null
    return (
        <span className={`badge ${pct > 80 ? 'bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400' : pct > 50 ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400'}`}>
            {intent}{pct != null ? ` ${pct}%` : ''}
        </span>
    )
}

export default function InspectorPage() {
    const { call } = useApi()
    const [apps, setApps]           = useState([])
    const [convos, setConvos]       = useState([])
    const [selected, setSelected]   = useState(null)
    const [messages, setMessages]   = useState([])
    const [tracker, setTracker]     = useState(null)
    const [nluInput, setNluInput]   = useState('')
    const [nluResult, setNluResult] = useState(null)
    const [filter, setFilter]       = useState({ app: '', search: '', limit: '50' })
    const [tab, setTab]             = useState('conversations') // 'conversations' | 'nlu'
    const [loading, setLoading]     = useState(true)
    const [loadingConvo, setLoadingConvo] = useState(false)
    const [error, setError]         = useState(null)

    useEffect(() => {
        call('/admin/analytics/apps')
            .then(d => setApps(d?.apps || d || []))
            .catch(() => {})
    }, [call])

    const loadConversations = useCallback(async () => {
        setLoading(true)
        const params = new URLSearchParams()
        if (filter.app)    params.set('app_id', filter.app)
        if (filter.search) params.set('search', filter.search)
        if (filter.limit)  params.set('limit', filter.limit)
        try {
            const d = await call(`/inspector/conversations?${params}`)
            setConvos(d?.conversations || d || [])
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, filter])

    useEffect(() => { loadConversations() }, [loadConversations])

    const openConversation = async (senderId) => {
        setSelected(senderId)
        setLoadingConvo(true)
        setMessages([])
        setTracker(null)
        try {
            const [msgData, trackerData] = await Promise.allSettled([
                call(`/inspector/conversation/${encodeURIComponent(senderId)}`),
                call(`/api/rasa/conversations/${encodeURIComponent(senderId)}/tracker`),
            ])
            if (msgData.status === 'fulfilled') setMessages(msgData.value?.messages || msgData.value?.events || [])
            if (trackerData.status === 'fulfilled') setTracker(trackerData.value)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoadingConvo(false)
        }
    }

    const testNlu = async (e) => {
        e.preventDefault()
        if (!nluInput.trim()) return
        try {
            const d = await call('/api/rasa/model/parse', {
                method: 'POST',
                body: JSON.stringify({ text: nluInput }),
            })
            setNluResult(d)
        } catch (e) {
            setError(e.message)
        }
    }

    return (
        <div className="max-w-6xl space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Inspector</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Inspect conversations, slots, intents, and test NLU</p>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            <div className="flex gap-3 border-b border-gray-200 dark:border-slate-700">
                {['conversations', 'nlu tester'].map(t => (
                    <button key={t} onClick={() => setTab(t.split(' ')[0])}
                        className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors capitalize ${
                            tab === t.split(' ')[0] ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 hover:dark:text-slate-300'
                        }`}>
                        {t}
                    </button>
                ))}
            </div>

            {tab === 'conversations' && (
                <div className="flex gap-4" style={{ minHeight: '520px' }}>
                    {/* Left: conversation list */}
                    <div className="w-72 shrink-0 space-y-3">
                        {/* Filters */}
                        <div className="card p-3 space-y-2">
                            {apps.length > 0 && (
                                <select value={filter.app} onChange={e => setFilter(p => ({ ...p, app: e.target.value }))}
                                    className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40">
                                    <option value="">All apps</option>
                                    {apps.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                            )}
                            <input value={filter.search} onChange={e => setFilter(p => ({ ...p, search: e.target.value }))}
                                placeholder="Search user / message…"
                                className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                            <div className="flex gap-2">
                                <select value={filter.limit} onChange={e => setFilter(p => ({ ...p, limit: e.target.value }))}
                                    className="border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40">
                                    {['25','50','100','200'].map(n => <option key={n}>{n}</option>)}
                                </select>
                                <button onClick={loadConversations} className="flex-1 btn-ghost border border-gray-200 dark:border-slate-700 text-xs">Filter</button>
                            </div>
                        </div>

                        <div className="card overflow-hidden">
                            {loading && (
                                <div className="flex justify-center py-8">
                                    <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                            <div className="divide-y divide-gray-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
                                {convos.map((c, i) => (
                                    <button key={i} onClick={() => openConversation(c.sender_id || c.id)}
                                        className={`w-full text-left px-4 py-3 hover:bg-blue-50 hover:dark:bg-blue-500/10 transition-colors ${selected === (c.sender_id || c.id) ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}>
                                        <p className="text-xs font-medium text-gray-900 dark:text-slate-100 truncate">{c.sender_id || c.id}</p>
                                        <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 truncate">{c.last_message || c.preview || ''}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            {c.app_id && <span className="badge bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 text-xs">{c.app_id}</span>}
                                            {c.message_count && <span className="text-xs text-gray-400 dark:text-slate-500">{c.message_count} msgs</span>}
                                        </div>
                                    </button>
                                ))}
                                {!loading && convos.length === 0 && (
                                    <p className="px-4 py-6 text-xs text-gray-500 dark:text-slate-400 text-center">No conversations found.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: conversation detail */}
                    <div className="flex-1 space-y-3">
                        {!selected && (
                            <div className="card flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-sm">
                                Select a conversation to inspect
                            </div>
                        )}

                        {selected && loadingConvo && (
                            <div className="card flex justify-center items-center h-64">
                                <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                            </div>
                        )}

                        {selected && !loadingConvo && (
                            <>
                                {/* Messages */}
                                <div className="card p-4 max-h-80 overflow-y-auto">
                                    {messages.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400 text-center py-4">No messages</p>}
                                    {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
                                </div>

                                {/* Slots */}
                                {tracker?.slots && Object.keys(tracker.slots).length > 0 && (
                                    <div className="card p-4">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Slots</p>
                                        <div className="flex flex-wrap gap-2">
                                            {Object.entries(tracker.slots).filter(([, v]) => v != null).map(([k, v]) => (
                                                <div key={k} className="bg-gray-100 dark:bg-slate-800 rounded px-2 py-1 text-xs">
                                                    <span className="font-medium text-gray-700 dark:text-slate-300">{k}:</span>
                                                    <span className="text-gray-600 dark:text-slate-400 ml-1 font-mono">{String(v)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Active story */}
                                {tracker?.active_loop?.name && (
                                    <div className="card p-4">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Active loop</p>
                                        <span className="badge bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400">{tracker.active_loop.name}</span>
                                    </div>
                                )}

                                {/* Last intent */}
                                {tracker?.latest_message?.intent && (
                                    <div className="card p-4">
                                        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Last intent</p>
                                        <IntentBadge intent={tracker.latest_message.intent.name} confidence={tracker.latest_message.intent.confidence} />
                                        {tracker.latest_message.entities?.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {tracker.latest_message.entities.map((e, i) => (
                                                    <span key={i} className="badge bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs">
                                                        {e.entity}: {e.value}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {tab === 'nlu' && (
                <div className="max-w-2xl space-y-4">
                    <div className="card p-5 space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">NLU tester</h3>
                        <form onSubmit={testNlu} className="flex gap-2">
                            <input value={nluInput} onChange={e => setNluInput(e.target.value)}
                                placeholder="Type a message to test intent classification…"
                                className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                            <button type="submit" disabled={!nluInput.trim()} className="btn-primary">Parse</button>
                        </form>
                    </div>

                    {nluResult && (
                        <div className="card p-5 space-y-4">
                            <div>
                                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Intent</p>
                                {nluResult.intent && (
                                    <IntentBadge intent={nluResult.intent.name} confidence={nluResult.intent.confidence} />
                                )}
                            </div>

                            {nluResult.intent_ranking?.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Rankings</p>
                                    <div className="space-y-1">
                                        {nluResult.intent_ranking.slice(0, 5).map((r, i) => (
                                            <div key={i} className="flex items-center gap-3">
                                                <span className="text-xs text-gray-700 dark:text-slate-300 w-40 truncate">{r.name}</span>
                                                <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2">
                                                    <div className="h-2 rounded-full bg-blue-500"
                                                        style={{ width: `${Math.round(r.confidence * 100)}%` }} />
                                                </div>
                                                <span className="text-xs text-gray-500 dark:text-slate-400 w-10 text-right">{Math.round(r.confidence * 100)}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {nluResult.entities?.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Entities</p>
                                    <div className="flex flex-wrap gap-2">
                                        {nluResult.entities.map((e, i) => (
                                            <span key={i} className="badge bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400">
                                                {e.entity}: <strong>{e.value}</strong>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
