import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner } from '../../../shared/itsm/primitives'

export default function AiBudgetSection() {
    const { get, patch } = useItsmApi()
    const { data: budget, loading, error, reload } = useItsmResource(() => get('/tenant/ai-budget'), [get])
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)

    const startEdit = () => { setValue(String(budget?.budget_tokens ?? '')); setSaveError(null); setEditing(true) }
    const save = async (e) => {
        e.preventDefault()
        const tokens = parseInt(value, 10)
        if (!Number.isFinite(tokens) || tokens < 0) { setSaveError(new Error('Enter a non-negative integer.')); return }
        setSaving(true); setSaveError(null)
        try { await patch('/tenant/ai-budget', { monthly_tokens: tokens }); setEditing(false); reload() }
        catch (err) { setSaveError(err) } finally { setSaving(false) }
    }

    return (
        <div className="space-y-2.5 max-w-md">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI token budget</h3>
                {!editing && budget && <button onClick={startEdit} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Edit</button>}
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {budget && !editing && (
                <div className="space-y-1.5">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">{budget.used_tokens.toLocaleString()}</span> / {budget.budget_tokens.toLocaleString()} tokens used this month ({budget.month})
                    </p>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                            className={`h-full rounded-full ${budget.percentage >= 100 ? 'bg-red-500' : budget.percentage >= 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(100, budget.percentage)}%` }}
                        />
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{budget.percentage}% of monthly budget</p>
                </div>
            )}

            {editing && (
                <form onSubmit={save} className="space-y-2">
                    <input type="number" min="0" className="input text-sm" required value={value} onChange={e => setValue(e.target.value)} />
                    {saveError && <ErrorBanner message={saveError.message} />}
                    <div className="flex items-center gap-2">
                        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">{saving ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-ghost text-xs py-1.5">Cancel</button>
                    </div>
                </form>
            )}
        </div>
    )
}
