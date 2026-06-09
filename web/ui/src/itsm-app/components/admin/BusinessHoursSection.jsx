import { useEffect, useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, FormField } from '../../../shared/itsm/primitives'

const DAYS = [
    { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 7, label: 'Sun' },
]

function toHHMM(t) {
    if (!t) return '09:00'
    return typeof t === 'string' ? t.slice(0, 5) : t
}

export default function BusinessHoursSection() {
    const { get, patch } = useItsmApi()
    const { data: bh, loading, error: loadError, reload } = useItsmResource(
        () => get('/tenant/business-hours').catch(err => (err.status === 404 ? null : Promise.reject(err))),
        [get]
    )

    const [timezone, setTimezone] = useState('UTC')
    const [workDays, setWorkDays] = useState(new Set([1, 2, 3, 4, 5]))
    const [startTime, setStartTime] = useState('09:00')
    const [endTime, setEndTime] = useState('17:00')
    const [holidays, setHolidays] = useState('')
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        if (!bh) return
        setTimezone(bh.timezone || 'UTC')
        setWorkDays(new Set(bh.work_days || [1, 2, 3, 4, 5]))
        setStartTime(toHHMM(bh.work_start_time))
        setEndTime(toHHMM(bh.work_end_time))
        setHolidays((bh.holidays || []).join(', '))
    }, [bh])

    const toggleDay = (day) => {
        setWorkDays(prev => {
            const next = new Set(prev)
            next.has(day) ? next.delete(day) : next.add(day)
            return next
        })
    }

    const save = async (e) => {
        e.preventDefault()
        setSaving(true); setSaveError(null); setSaved(false)
        try {
            await patch('/tenant/business-hours', {
                timezone,
                work_days: [...workDays].sort(),
                work_start_time: startTime,
                work_end_time: endTime,
                holidays: holidays.split(',').map(s => s.trim()).filter(Boolean),
            })
            setSaved(true)
            reload()
        } catch (err) { setSaveError(err) } finally { setSaving(false) }
    }

    return (
        <div className="space-y-3 max-w-lg">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Business hours</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">Determines when SLA timers run for "business hours only" policies.</p>

            {loading && <LoadingSpinner />}
            {loadError && <ErrorBanner message={loadError.message} />}

            <form onSubmit={save} className="space-y-3">
                <FormField label="Timezone (IANA name)">
                    <input className="input text-sm" required value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="e.g. America/New_York" />
                </FormField>
                <FormField label="Work days">
                    <div className="flex flex-wrap gap-2">
                        {DAYS.map(d => (
                            <label key={d.value} className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700">
                                <input type="checkbox" checked={workDays.has(d.value)} onChange={() => toggleDay(d.value)} />
                                {d.label}
                            </label>
                        ))}
                    </div>
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Start time">
                        <input type="time" className="input text-sm" required value={startTime} onChange={e => setStartTime(e.target.value)} />
                    </FormField>
                    <FormField label="End time">
                        <input type="time" className="input text-sm" required value={endTime} onChange={e => setEndTime(e.target.value)} />
                    </FormField>
                </div>
                <FormField label="Holidays (comma-separated YYYY-MM-DD dates)">
                    <input className="input text-sm" value={holidays} onChange={e => setHolidays(e.target.value)} placeholder="2026-01-01, 2026-12-25" />
                </FormField>

                {saveError && <ErrorBanner message={saveError.message} />}
                {saved && <p className="text-xs text-green-600 dark:text-green-400">Saved.</p>}
                <button type="submit" disabled={saving || workDays.size === 0} className="btn-primary text-sm">
                    {saving ? 'Saving…' : bh ? 'Save changes' : 'Create configuration'}
                </button>
            </form>
        </div>
    )
}
