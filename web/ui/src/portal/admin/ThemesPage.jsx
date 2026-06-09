import { useState, useEffect } from 'react'
import { useApi } from '../useApi'

const DEFAULT_THEME = {
    name: '',
    primaryColor: '#2563eb',
    secondaryColor: '#1d4ed8',
    bgColor: '#ffffff',
    textColor: '#1f2937',
    fontFamily: 'Inter',
    borderRadius: '12',
    headerFontSize: '16',
    messageFontSize: '14',
    buttonFontSize: '13',
    inputFontSize: '14',
    botIcon: '🤖',
    userIcon: '👤',
}

function ColorField({ label, k, value, onChange }) {
    return (
        <div>
            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">{label}</label>
            <div className="flex gap-2 items-center">
                <input type="color" value={value || '#000000'} onChange={e => onChange(k, e.target.value)}
                    className="h-9 w-12 border border-gray-200 dark:border-slate-700 rounded cursor-pointer shrink-0" />
                <input value={value || ''} onChange={e => onChange(k, e.target.value)}
                    className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
            </div>
        </div>
    )
}

function TextField({ label, k, value, onChange }) {
    return (
        <div>
            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">{label}</label>
            <input value={value || ''} onChange={e => onChange(k, e.target.value)}
                className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
        </div>
    )
}

export default function ThemesPage() {
    const { call } = useApi()
    const [themes, setThemes]     = useState([])
    const [editing, setEditing]   = useState(null) // null = list, 'new' or theme id
    const [form, setForm]         = useState({ ...DEFAULT_THEME })
    const [loading, setLoading]   = useState(true)
    const [saving, setSaving]     = useState(false)
    const [error, setError]       = useState(null)

    const loadThemes = async () => {
        try {
            const d = await call('/admin/themes')
            setThemes(d?.themes || d || [])
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadThemes() }, [call])

    const startNew = () => { setForm({ ...DEFAULT_THEME }); setEditing('new') }
    const startEdit = (t) => { setForm({ ...DEFAULT_THEME, ...(t.settings || {}), name: t.name }); setEditing(t.id) }

    const handleChange = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

    const handleSave = async () => {
        setSaving(true)
        try {
            const { name, ...settings } = form
            const payload = { name, settings }
            if (editing === 'new') {
                await call('/admin/themes', { method: 'POST', body: JSON.stringify(payload) })
            } else {
                await call(`/admin/themes/${editing}`, { method: 'PUT', body: JSON.stringify(payload) })
            }
            await loadThemes()
            setEditing(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id) => {
        if (!confirm('Delete this theme?')) return
        try {
            await call(`/admin/themes/${id}`, { method: 'DELETE' })
            await loadThemes()
        } catch (e) {
            setError(e.message)
        }
    }

    if (loading) return (
        <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )

    if (editing) return (
        <div className="max-w-3xl space-y-6">
            <div className="flex items-center gap-3">
                <button onClick={() => setEditing(null)} className="btn-ghost border border-gray-200 dark:border-slate-700 text-sm">← Back</button>
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{editing === 'new' ? 'New theme' : 'Edit theme'}</h2>
                </div>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            <div className="card p-5 space-y-5">
                <TextField label="Theme name" k="name" value={form.name} onChange={handleChange} />

                <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Colors</p>
                    <div className="grid grid-cols-2 gap-4">
                        <ColorField label="Primary"    k="primaryColor"   value={form.primaryColor}   onChange={handleChange} />
                        <ColorField label="Secondary"  k="secondaryColor" value={form.secondaryColor} onChange={handleChange} />
                        <ColorField label="Background" k="bgColor"        value={form.bgColor}        onChange={handleChange} />
                        <ColorField label="Text"       k="textColor"      value={form.textColor}      onChange={handleChange} />
                    </div>
                </div>

                <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Typography</p>
                    <div className="grid grid-cols-2 gap-4">
                        <TextField label="Font family"       k="fontFamily"       value={form.fontFamily}       onChange={handleChange} />
                        <TextField label="Border radius (px)" k="borderRadius"    value={form.borderRadius}     onChange={handleChange} />
                        <TextField label="Header font size"   k="headerFontSize"  value={form.headerFontSize}   onChange={handleChange} />
                        <TextField label="Message font size"  k="messageFontSize" value={form.messageFontSize}  onChange={handleChange} />
                        <TextField label="Button font size"   k="buttonFontSize"  value={form.buttonFontSize}   onChange={handleChange} />
                        <TextField label="Input font size"    k="inputFontSize"   value={form.inputFontSize}    onChange={handleChange} />
                    </div>
                </div>

                <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Icons</p>
                    <div className="grid grid-cols-2 gap-4">
                        <TextField label="Bot icon (emoji)" k="botIcon"  value={form.botIcon}  onChange={handleChange} />
                        <TextField label="User icon (emoji)" k="userIcon" value={form.userIcon} onChange={handleChange} />
                    </div>
                </div>

                {/* Live preview swatch */}
                <div>
                    <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">Preview</p>
                    <div className="rounded-xl p-4 border" style={{ backgroundColor: form.bgColor, borderColor: form.primaryColor + '40' }}>
                        <div className="rounded-lg px-3 py-2 inline-block text-sm" style={{ backgroundColor: form.primaryColor, color: '#fff', borderRadius: form.borderRadius + 'px' }}>
                            {form.botIcon} Bot message
                        </div>
                        <div className="mt-2 text-right">
                            <span className="rounded-lg px-3 py-2 inline-block text-sm" style={{ backgroundColor: form.secondaryColor + '20', color: form.textColor }}>
                                {form.userIcon} User message
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                    {saving ? 'Saving…' : 'Save theme'}
                </button>
            </div>
        </div>
    )

    return (
        <div className="max-w-3xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Themes</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Widget colour themes</p>
                </div>
                <button onClick={startNew} className="btn-primary">+ New theme</button>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {themes.length === 0 && (
                <div className="card p-8 text-center text-gray-500 dark:text-slate-400 text-sm">
                    No themes yet. Create one to customise the widget appearance.
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {themes.map(t => {
                    const s = t.settings || {}
                    return (
                        <div key={t.id} className="card p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <p className="font-medium text-gray-900 dark:text-slate-100">
                                    {t.name || 'Unnamed'}
                                    {t.is_default && <span className="ml-2 badge text-xs bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400">Default</span>}
                                </p>
                                <div className="flex gap-1">
                                    <div className="w-5 h-5 rounded-full border border-white shadow-sm" style={{ backgroundColor: s.primaryColor || '#e5e7eb' }} />
                                    <div className="w-5 h-5 rounded-full border border-white shadow-sm" style={{ backgroundColor: s.bgColor || '#e5e7eb' }} />
                                </div>
                            </div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 font-mono">{s.primaryColor || '—'} · r{s.borderRadius || '0'}px · {s.fontFamily || 'default'}</p>
                            <div className="flex gap-2">
                                <button onClick={() => startEdit(t)} className="btn-ghost text-xs border border-gray-200 dark:border-slate-700 flex-1">Edit</button>
                                <button onClick={() => handleDelete(t.id)} className="px-3 py-1.5 text-xs rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-500/10 transition-colors">Delete</button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
