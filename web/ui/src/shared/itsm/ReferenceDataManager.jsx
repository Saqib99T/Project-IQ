/**
 * Generic reference-data manager: list + search + create/edit drawer +
 * optional hierarchy (tree indent + parent picker) + soft delete.
 *
 * One component powers every reference entity in the Administration hub
 * (departments, ticket/asset categories, asset types, vendors, KB tags…).
 * Callers describe *what* to manage via a config object; the component owns
 * the *how* (loading, forms, validation, toasts, confirms).
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, FolderTree } from 'lucide-react'
import { useItsmApi, useItsmResource } from './useItsmApi'
import {
    Button, IconButton, Badge, Drawer, DataTable, SearchInput, FilterBar,
    PageHeader, useToast, useConfirm,
} from './ui'
import { ErrorBanner, FormField } from './primitives'

/**
 * @param {object}   cfg
 * @param {string}   cfg.title
 * @param {string}   [cfg.description]
 * @param {Function} [cfg.icon]            lucide icon component
 * @param {string}   cfg.listPath          GET endpoint (returns array)
 * @param {string}   cfg.createPath        POST endpoint
 * @param {Function} cfg.itemPath          (id) => PATCH/DELETE endpoint
 * @param {boolean}  [cfg.canDelete]
 * @param {boolean}  [cfg.canManage=true]  whether the user may create/edit
 * @param {boolean}  [cfg.hierarchical]    indent by parent_id + parent picker
 * @param {Array}    cfg.columns           extra display columns (besides name)
 * @param {Array}    cfg.fields            form fields
 * @param {Function} [cfg.nameKey='name']
 */
export default function ReferenceDataManager(cfg) {
    const {
        title, description, icon, listPath, itemPath,
        canDelete = true, canManage = true, hierarchical = false, isPlatform = false,
        columns = [], nameKey = 'name',
    } = cfg

    const { get, post, patch, remove } = useItsmApi()
    const { toast } = useToast()
    const confirm = useConfirm()

    const { data, loading, error, reload } = useItsmResource(() => get(listPath), [get, listPath])
    const items = useMemo(() => data || [], [data])

    const [search, setSearch] = useState('')
    const [showInactive, setShowInactive] = useState(false)
    const [editing, setEditing] = useState(null)   // null | {} (new) | row (edit)
    const hasActiveFlag = items.some(i => 'is_active' in i)
    const hasScope = items.some(i => 'tenant_id' in i)

    // ---- tree ordering (parent → children, depth for indent) --------------
    const { ordered, depthOf } = useMemo(() => {
        if (!hierarchical) return { ordered: items, depthOf: () => 0 }
        const byParent = new Map()
        for (const it of items) {
            const p = it.parent_id || '__root__'
            if (!byParent.has(p)) byParent.set(p, [])
            byParent.get(p).push(it)
        }
        const depth = new Map()
        const out = []
        const walk = (parentKey, d) => {
            const kids = (byParent.get(parentKey) || []).sort((a, b) => (a[nameKey] || '').localeCompare(b[nameKey] || ''))
            for (const k of kids) {
                depth.set(k.id, d)
                out.push(k)
                walk(k.id, d + 1)
            }
        }
        walk('__root__', 0)
        // include any orphans whose parent isn't in the set
        for (const it of items) if (!depth.has(it.id)) { depth.set(it.id, 0); out.push(it) }
        return { ordered: out, depthOf: (row) => depth.get(row.id) || 0 }
    }, [items, hierarchical, nameKey])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return ordered.filter(row => {
            if (!showInactive && hasActiveFlag && row.is_active === false) return false
            if (!q) return true
            return [row[nameKey], row.description].filter(Boolean).some(v => String(v).toLowerCase().includes(q))
        })
    }, [ordered, search, showInactive, hasActiveFlag, nameKey])

    // ---- columns ----------------------------------------------------------
    const tableColumns = [
        {
            key: nameKey, header: 'Name', sortable: false,
            render: (row) => (
                <span className="font-medium text-slate-800 dark:text-slate-200">{row[nameKey]}</span>
            ),
        },
        ...columns,
        ...(hasScope ? [{
            key: 'tenant_id', header: 'Scope', width: '100px',
            render: (row) => row.tenant_id == null
                ? <Badge tone="indigo">Global</Badge>
                : <Badge tone="gray">Tenant</Badge>,
        }] : []),
        ...(hasActiveFlag ? [{
            key: 'is_active', header: 'Status', width: '110px',
            render: (row) => row.is_active === false
                ? <Badge tone="gray">Inactive</Badge>
                : <Badge tone="green">Active</Badge>,
        }] : []),
        ...(canManage ? [{
            key: '_actions', header: '', width: '90px', className: 'text-right',
            render: (row) => {
                // Tenant users can't edit global rows (platform-managed); backend
                // enforces this too — we just avoid showing dead buttons.
                const locked = row.tenant_id == null && !isPlatform
                if (locked) return <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                return (
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <IconButton icon={Pencil} label="Edit" size="sm" onClick={() => setEditing(row)} />
                        {canDelete && (
                            <IconButton icon={Trash2} label="Delete" size="sm"
                                className="hover:text-red-600 dark:hover:text-red-400"
                                onClick={() => handleDelete(row)} />
                        )}
                    </div>
                )
            },
        }] : []),
    ]

    const handleDelete = async (row) => {
        const ok = await confirm({
            title: `Delete ${title.replace(/s$/, '').toLowerCase()}?`,
            message: `"${row[nameKey]}" will be permanently removed. This cannot be undone.`,
            danger: true, confirmLabel: 'Delete',
        })
        if (!ok) return
        try {
            await remove(itemPath(row.id))
            toast(`Deleted "${row[nameKey]}"`, 'success')
            reload()
        } catch (err) {
            toast(err.message || 'Delete failed', 'error')
        }
    }

    return (
        <div className="space-y-4">
            <PageHeader
                title={title}
                subtitle={description}
                icon={icon}
                actions={canManage && <Button icon={Plus} onClick={() => setEditing({})}>New</Button>}
            />

            <FilterBar>
                <SearchInput value={search} onChange={setSearch} placeholder={`Search ${title.toLowerCase()}…`} className="w-64" />
                {hasActiveFlag && (
                    <label className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 ml-1">
                        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
                        Show inactive
                    </label>
                )}
                {hierarchical && (
                    <Badge tone="indigo" icon={FolderTree} className="ml-auto">Hierarchical</Badge>
                )}
            </FilterBar>

            {error && <ErrorBanner message={error.message} />}

            <DataTable
                columns={tableColumns}
                rows={filtered}
                loading={loading}
                empty={`No ${title.toLowerCase()} yet.`}
                indent={hierarchical ? depthOf : undefined}
            />

            <EditorDrawer
                cfg={cfg}
                open={editing != null}
                row={editing && editing.id ? editing : null}
                items={items}
                onClose={() => setEditing(null)}
                onSaved={() => { setEditing(null); reload() }}
                api={{ post, patch }}
                toast={toast}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Create / edit drawer
// ---------------------------------------------------------------------------

function EditorDrawer({ cfg, open, row, items, onClose, onSaved, api, toast }) {
    const { title, createPath, itemPath, fields = [], hierarchical, nameKey = 'name' } = cfg
    const isEdit = !!row

    const buildInitial = () => {
        const base = {}
        for (const f of fields) {
            let v = row ? (row[f.name] ?? '') : (f.default ?? '')
            if (f.type === 'json' && v && typeof v === 'object') v = JSON.stringify(v, null, 2)
            base[f.name] = v
        }
        if (hierarchical) base.parent_id = row?.parent_id ?? ''
        return base
    }

    const [form, setForm] = useState(buildInitial)
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState(null)
    // Re-seed the form whenever the drawer opens for a different row
    const [seed, setSeed] = useState(0)
    useEffect(() => {
        if (open) { setForm(buildInitial()); setErr(null); setSeed(s => s + 1) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, row])

    const setField = (name, value) => setForm(f => ({ ...f, [name]: value }))

    // descendants of the edited row can't be its parent (cycle guard)
    const parentOptions = useMemo(() => {
        if (!hierarchical) return []
        const blocked = new Set()
        if (row) {
            blocked.add(row.id)
            const byParent = new Map()
            for (const it of items) {
                const p = it.parent_id || '__root__'
                if (!byParent.has(p)) byParent.set(p, [])
                byParent.get(p).push(it)
            }
            const stack = [row.id]
            while (stack.length) {
                const cur = stack.pop()
                for (const c of byParent.get(cur) || []) { blocked.add(c.id); stack.push(c.id) }
            }
        }
        return items.filter(i => !blocked.has(i.id))
    }, [items, row, hierarchical])

    const submit = async (e) => {
        e.preventDefault()
        setSaving(true); setErr(null)
        try {
            const payload = {}
            for (const f of fields) {
                let v = form[f.name]
                if (f.type === 'json') {
                    if (v === '' || v == null) { payload[f.name] = {} ; continue }
                    try { payload[f.name] = typeof v === 'string' ? JSON.parse(v) : v }
                    catch { throw new Error(`${f.label} must be valid JSON`) }
                    continue
                }
                if (v === '' && !f.required) v = f.type === 'number' ? null : (f.nullable !== false ? null : '')
                if (f.type === 'number' && v != null && v !== '') v = Number(v)
                if (v !== '' || f.required) payload[f.name] = v
            }
            if (hierarchical) payload.parent_id = form.parent_id || null

            if (isEdit) await api.patch(itemPath(row.id), payload)
            else await api.post(createPath, payload)
            toast(isEdit ? 'Changes saved' : `${title.replace(/s$/, '')} created`, 'success')
            onSaved()
        } catch (e2) {
            setErr(e2)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={isEdit ? `Edit ${title.replace(/s$/, '').toLowerCase()}` : `New ${title.replace(/s$/, '').toLowerCase()}`}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} type="button">Cancel</Button>
                    <Button size="sm" onClick={submit} disabled={saving} type="submit">{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}</Button>
                </>
            }
        >
            <form onSubmit={submit} className="space-y-3.5" key={seed}>
                {err && <ErrorBanner message={err.message} />}
                {fields.map((f) => (
                    <FormField key={f.name} label={f.label + (f.required ? ' *' : '')}>
                        {f.type === 'textarea' || f.type === 'json' ? (
                            <textarea className={f.type === 'json' ? 'input min-h-[120px] font-mono text-xs' : 'input min-h-[80px]'}
                                required={f.required} value={form[f.name] ?? ''}
                                placeholder={f.placeholder || (f.type === 'json' ? '{ }' : '')} onChange={e => setField(f.name, e.target.value)} />
                        ) : f.type === 'select' ? (
                            <select className="select" required={f.required} value={form[f.name] ?? ''} onChange={e => setField(f.name, e.target.value)}>
                                <option value="">{f.placeholder || '— none —'}</option>
                                {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        ) : f.type === 'checkbox' ? (
                            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <input type="checkbox" checked={!!form[f.name]} onChange={e => setField(f.name, e.target.checked)} className="rounded" />
                                {f.checkboxLabel || f.label}
                            </label>
                        ) : (
                            <input className="input" type={f.type || 'text'} required={f.required} value={form[f.name] ?? ''}
                                placeholder={f.placeholder} onChange={e => setField(f.name, e.target.value)} />
                        )}
                        {f.help && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{f.help}</p>}
                    </FormField>
                ))}

                {hierarchical && (
                    <FormField label="Parent">
                        <select className="select" value={form.parent_id ?? ''} onChange={e => setField('parent_id', e.target.value)}>
                            <option value="">— top level —</option>
                            {parentOptions.map(p => <option key={p.id} value={p.id}>{p[nameKey]}</option>)}
                        </select>
                    </FormField>
                )}
            </form>
        </Drawer>
    )
}
