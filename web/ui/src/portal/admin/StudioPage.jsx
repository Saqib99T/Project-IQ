import { useState, useEffect, useRef } from 'react'
import { useApi } from '../useApi'

const FILE_META = {
    'domain.yml':       { icon: '🗺️',  label: 'Domain',      hint: 'Intents, entities, slots & responses' },
    'config.yml':       { icon: '⚙️',  label: 'Pipeline config', hint: 'NLU pipeline & policies' },
    'endpoints.yml':    { icon: '🔌',  label: 'Endpoints',   hint: 'Action server & tracker store' },
    'credentials.yml':  { icon: '🔑',  label: 'Credentials', hint: 'Channel connectors' },
    'data/nlu.yml':     { icon: '💬',  label: 'NLU data',    hint: 'Training examples per intent' },
    'data/stories.yml': { icon: '📖',  label: 'Stories',     hint: 'Conversation flow examples' },
    'data/rules.yml':   { icon: '📏',  label: 'Rules',       hint: 'Fixed conversation rules' },
}
const fileMeta = (name) => FILE_META[name] || { icon: '📄', label: name, hint: '' }

const fmtSize = (bytes) => {
    if (bytes == null) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const fmtRelative = (iso) => {
    if (!iso) return '—'
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.round(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.round(hrs / 24)}d ago`
}

export default function StudioPage() {
    const { call } = useApi()
    const [files, setFiles]       = useState([])
    const [activeFile, setActiveFile] = useState(null)
    const [content, setContent]   = useState('')
    const [history, setHistory]   = useState([])
    const [trainLog, setTrainLog] = useState([])
    const [trainStatus, setTrainStatus] = useState(null)
    const [loading, setLoading]   = useState(true)
    const [saving, setSaving]     = useState(false)
    const [training, setTraining] = useState(false)
    const [tab, setTab]           = useState('editor') // 'editor' | 'history'
    const [error, setError]       = useState(null)
    const [saved, setSaved]       = useState(false)
    const logRef = useRef(null)

    useEffect(() => {
        call('/admin/studio/files')
            .then(d => {
                const list = d?.files || []
                setFiles(list)
                if (list.length) openFile(list[0].name)
                else setLoading(false)
            })
            .catch(e => { setError(e.message); setLoading(false) })
    }, [call])

    const openFile = async (filename) => {
        setLoading(true)
        setActiveFile(filename)
        try {
            const d = await call(`/admin/studio/file?name=${encodeURIComponent(filename)}`)
            setContent(d?.content || '')
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        if (!activeFile) return
        setSaving(true)
        try {
            await call('/admin/studio/file', {
                method: 'POST',
                body: JSON.stringify({ name: activeFile, content }),
            })
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    const handleTrain = async () => {
        setTraining(true)
        setTrainLog([])
        setTrainStatus('running')
        try {
            await call('/admin/studio/train', { method: 'POST', body: JSON.stringify({}) })
            const poll = setInterval(async () => {
                try {
                    const d = await call('/admin/studio/train/current')
                    const status = d?.status || {}
                    setTrainLog(status.logs ? status.logs.split('\n').filter(Boolean) : [])
                    if (!status.is_training) {
                        setTrainStatus('done')
                        clearInterval(poll)
                        setTraining(false)
                    }
                } catch { clearInterval(poll); setTraining(false) }
            }, 2000)
        } catch (e) {
            setError(e.message)
            setTraining(false)
        }
    }

    const loadHistory = async () => {
        try {
            const d = await call('/admin/studio/history')
            setHistory(d?.history || [])
        } catch (e) {
            setError(e.message)
        }
    }

    const handleRestore = async (versionId) => {
        try {
            await call('/admin/studio/restore', { method: 'POST', body: JSON.stringify({ version_id: versionId }) })
            if (activeFile) openFile(activeFile)
        } catch (e) {
            setError(e.message)
        }
    }

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, [trainLog])

    return (
        <div className="max-w-5xl space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Bot Studio</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Edit NLU training data and retrain the model</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleSave} disabled={saving || !activeFile} className="btn-ghost border border-gray-200 dark:border-slate-700">
                        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                    </button>
                    <button onClick={handleTrain} disabled={training} className="btn-primary">
                        {training ? 'Training…' : '▶ Train model'}
                    </button>
                </div>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            <div className="flex gap-3 border-b border-gray-200 dark:border-slate-700">
                {['editor', 'history'].map(t => (
                    <button
                        key={t}
                        onClick={() => { setTab(t); if (t === 'history') loadHistory() }}
                        className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors capitalize ${
                            tab === t ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 hover:dark:text-slate-300'
                        }`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {tab === 'editor' && (
                <div className="flex gap-4" style={{ minHeight: '520px' }}>
                    {/* File list */}
                    <div className="w-64 shrink-0 space-y-2 self-start">
                        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider px-1">Training files</p>
                        {files.map(f => {
                            const meta = fileMeta(f.name)
                            const active = activeFile === f.name
                            return (
                                <button
                                    key={f.name}
                                    onClick={() => openFile(f.name)}
                                    className={`w-full text-left card p-3 transition-colors ${
                                        active ? 'ring-2 ring-blue-500 dark:ring-blue-400/40 bg-blue-50 dark:bg-blue-500/10/40' : 'hover:bg-gray-50 hover:dark:bg-slate-800/60'
                                    }`}
                                >
                                    <div className="flex items-start gap-2.5">
                                        <span className="text-xl shrink-0 leading-none">{meta.icon}</span>
                                        <div className="min-w-0">
                                            <p className={`text-sm font-medium truncate ${active ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-slate-100'}`}>{meta.label}</p>
                                            <p className="text-[11px] text-gray-400 dark:text-slate-500 font-mono truncate">{f.name}</p>
                                            <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400 dark:text-slate-500">
                                                <span>{fmtSize(f.size)}</span>
                                                <span>·</span>
                                                <span>{fmtRelative(f.last_modified)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    {/* Editor */}
                    <div className="flex-1 card overflow-hidden flex flex-col">
                        {activeFile && (
                            <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2">
                                <span className="text-base leading-none">{fileMeta(activeFile).icon}</span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{fileMeta(activeFile).label}</p>
                                    {fileMeta(activeFile).hint && <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{fileMeta(activeFile).hint}</p>}
                                </div>
                                <span className="ml-auto text-xs text-gray-400 dark:text-slate-500 font-mono shrink-0">{activeFile}</span>
                            </div>
                        )}
                        <textarea
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            spellCheck={false}
                            className="flex-1 p-4 text-xs font-mono text-gray-900 dark:text-slate-100 resize-none focus:outline-none bg-white dark:bg-slate-900"
                            style={{ minHeight: '460px', tabSize: 2 }}
                            onKeyDown={e => {
                                if (e.key === 'Tab') {
                                    e.preventDefault()
                                    const s = e.target.selectionStart
                                    const v = content.slice(0, s) + '  ' + content.slice(s)
                                    setContent(v)
                                    requestAnimationFrame(() => e.target.setSelectionRange(s + 2, s + 2))
                                }
                            }}
                        />
                    </div>
                </div>
            )}

            {tab === 'history' && (
                <div className="card overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                        <h3 className="font-semibold text-gray-800 dark:text-slate-200">Version history</h3>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-slate-800">
                        {history.length === 0 && <p className="px-5 py-6 text-sm text-gray-500 dark:text-slate-400">No history found.</p>}
                        {history.map((h, i) => (
                            <div key={i} className="flex items-center justify-between px-5 py-3">
                                <div>
                                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{h.original || h.filename || `Version ${i + 1}`}</p>
                                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{h.timestamp}</p>
                                </div>
                                <button
                                    onClick={() => handleRestore(h.version_id)}
                                    className="btn-ghost text-xs border border-gray-200 dark:border-slate-700"
                                >
                                    Restore
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Training log */}
            {(training || trainLog.length > 0) && (
                <div className="card overflow-hidden">
                    <div className="px-5 py-3 bg-gray-900 flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-300 dark:text-slate-600 uppercase tracking-wider">Training log</p>
                        {trainStatus && (
                            <span className={`badge text-xs ${trainStatus === 'done' ? 'bg-green-800 text-green-200' : trainStatus === 'error' ? 'bg-red-800 text-red-200' : 'bg-blue-800 text-blue-200'}`}>
                                {trainStatus}
                            </span>
                        )}
                    </div>
                    <div ref={logRef} className="bg-gray-950 px-5 py-4 h-48 overflow-y-auto font-mono text-xs text-green-400 space-y-0.5">
                        {trainLog.map((line, i) => <p key={i}>{line}</p>)}
                        {training && <p className="animate-pulse">▌</p>}
                    </div>
                </div>
            )}
        </div>
    )
}
