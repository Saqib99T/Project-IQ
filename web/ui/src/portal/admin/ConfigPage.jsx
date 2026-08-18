import { useState, useEffect } from 'react'
import { useApi } from '../useApi'

const SECTIONS = {
    'ML CORE':      ['rasa_api_url', 'rasa_action_url'],
    SERVER:         ['admin_port', 'cors_origins'],
    KNOWLEDGE_BASE: ['kb_refresh_interval', 'kb_semantic_enabled',
                     'kb_semantic_model', 'kb_semantic_weight', 'kb_keyword_weight',
                     'kb_min_score', 'kb_max_results'],
    HANDOFF:        ['operator_jwt_secret', 'operator_jwt_expiry_hours',
                     'operator_heartbeat_timeout_secs'],
    SESSION:        ['session_timeout_minutes', 'session_warning_minutes'],
    SMTP:           ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'smtp_use_tls'],
    REDIS:          ['redis_enabled', 'redis_host', 'redis_port', 'redis_db'],
    LLM:            ['llm_summary_enabled', 'llm_summary_model', 'llm_api_key'],
    'COMMERCE INTEGRATIONS': ['SHOPIFY_ENABLED', 'AMAZON_ENABLED'],
}

function ConfigField({ k, value, onChange }) {
    const isBool = value === 'true' || value === 'false'
    const isSecret = k.toLowerCase().includes('secret') || k.toLowerCase().includes('password') || k.toLowerCase().includes('key')
    return (
        <div className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-slate-800 last:border-0">
            <label className="text-sm text-gray-600 dark:text-slate-400 w-56 shrink-0 font-mono">{k.replace(/rasa/gi, 'core')}</label>
            {isBool
                ? <select
                    value={value}
                    onChange={e => onChange(k, e.target.value)}
                    className="border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                : <input
                    type={isSecret ? 'password' : 'text'}
                    value={value ?? ''}
                    onChange={e => onChange(k, e.target.value)}
                    className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono"
                  />
            }
        </div>
    )
}

export default function ConfigPage() {
    const { call } = useApi()
    const [config, setConfig]   = useState(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving]   = useState(false)
    const [error, setError]     = useState(null)
    const [saved, setSaved]     = useState(false)

    useEffect(() => {
        call('/admin/config')
            .then(d => setConfig(d?.config || null))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call])

    const handleChange = (key, val) => setConfig(prev => ({ ...prev, [key]: val }))

    const handleSave = async () => {
        setSaving(true)
        setError(null)
        try {
            await call('/admin/config', { method: 'POST', body: JSON.stringify(config) })
            setSaved(true)
            setTimeout(() => setSaved(false), 3000)
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    if (loading) return (
        <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )

    const allKeys = config ? Object.keys(config) : []

    return (
        <div className="max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Configuration</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">System configuration — changes take effect on next server restart</p>
                </div>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                    {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
                </button>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {config && Object.entries(SECTIONS).map(([section, keys]) => {
                const rows = keys.filter(k => k in config)
                if (!rows.length) return null
                return (
                    <div key={section} className="card overflow-hidden">
                        <div className="px-5 py-3 bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700">
                            <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{section}</h3>
                        </div>
                        <div className="px-5 py-2">
                            {rows.map(k => (
                                <ConfigField key={k} k={k} value={config[k]} onChange={handleChange} />
                            ))}
                        </div>
                    </div>
                )
            })}

            {/* Catch-all for keys not in known sections */}
            {config && (() => {
                const knownKeys = new Set(Object.values(SECTIONS).flat())
                const extra = allKeys.filter(k => !knownKeys.has(k))
                if (!extra.length) return null
                return (
                    <div className="card overflow-hidden">
                        <div className="px-5 py-3 bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700">
                            <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">OTHER</h3>
                        </div>
                        <div className="px-5 py-2">
                            {extra.map(k => (
                                <ConfigField key={k} k={k} value={config[k]} onChange={handleChange} />
                            ))}
                        </div>
                    </div>
                )
            })()}
        </div>
    )
}
