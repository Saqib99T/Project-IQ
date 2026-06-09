/**
 * Concrete reference-data admin sections — each configures the generic
 * ReferenceDataManager for one entity. Sections that reference other entities
 * (SLA policies, teams, asset categories, KB spaces) fetch those first to
 * populate select options.
 */
import { useMemo, useState } from 'react'
import { Building2, Tags, Boxes, Layers, Truck, FolderTree, Hash } from 'lucide-react'
import ReferenceDataManager from '../../../shared/itsm/ReferenceDataManager'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner } from '../../../shared/itsm/primitives'
import { Badge } from '../../../shared/itsm/ui'

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

export function DepartmentsSection({ canManage, isPlatform }) {
    return (
        <ReferenceDataManager
            title="Departments"
            description="Organizational units, mirrored from IAM facilities. Supports nested hierarchy."
            icon={Building2}
            listPath="/tenant/departments"
            createPath="/tenant/departments"
            itemPath={(id) => `/tenant/departments/${id}`}
            canManage={canManage}
            isPlatform={isPlatform}
            canDelete={false}
            hierarchical
            fields={[
                { name: 'name', label: 'Name', required: true, placeholder: 'e.g. IT Support' },
                { name: 'description', label: 'Description', type: 'textarea' },
                { name: 'iam_facility_id', label: 'IAM facility ID', placeholder: 'Optional link to an IAM facility' },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// Asset categories
// ---------------------------------------------------------------------------

export function AssetCategoriesSection({ canManage, isPlatform }) {
    return (
        <ReferenceDataManager
            title="Asset Categories"
            description="Top-level classification for assets (e.g. Hardware ▸ Laptops). Asset types belong to a category."
            icon={Layers}
            listPath="/asset-categories"
            createPath="/asset-categories"
            itemPath={(id) => `/asset-categories/${id}`}
            canManage={canManage}
            isPlatform={isPlatform}
            canDelete={false}
            hierarchical
            fields={[
                { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Networking' },
                { name: 'description', label: 'Description', type: 'textarea' },
                { name: 'icon', label: 'Icon', placeholder: 'Optional icon name' },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export function VendorsSection({ canManage, isPlatform }) {
    return (
        <ReferenceDataManager
            title="Vendors"
            description="Suppliers and manufacturers linked to assets and maintenance records."
            icon={Truck}
            listPath="/vendors?active_only=false"
            createPath="/vendors"
            itemPath={(id) => `/vendors/${id}`}
            canManage={canManage}
            isPlatform={isPlatform}
            canDelete={false}
            columns={[
                { key: 'contact_email', header: 'Email', render: (r) => r.contact_email || '—' },
                { key: 'contact_phone', header: 'Phone', render: (r) => r.contact_phone || '—' },
            ]}
            fields={[
                { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Dell Technologies' },
                { name: 'contact_email', label: 'Contact email', type: 'email' },
                { name: 'contact_phone', label: 'Contact phone' },
                { name: 'website', label: 'Website', placeholder: 'https://…' },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// Ticket categories (needs SLA policies + teams for defaults)
// ---------------------------------------------------------------------------

export function TicketCategoriesSection({ canManage, isPlatform }) {
    const { get } = useItsmApi()
    const { data, loading, error } = useItsmResource(
        () => Promise.all([
            get('/tenant/sla-policies').catch(() => []),
            get('/tenant/teams').catch(() => []),
        ]).then(([slas, teams]) => ({ slas, teams })),
        [get],
    )
    if (loading) return <LoadingSpinner />
    if (error) return <ErrorBanner message={error.message} />

    const slaOptions = (data.slas || []).map(s => ({ value: s.id, label: s.name }))
    const teamOptions = (data.teams || []).map(t => ({ value: t.id, label: t.name }))
    const slaName = Object.fromEntries((data.slas || []).map(s => [s.id, s.name]))
    const teamName = Object.fromEntries((data.teams || []).map(t => [t.id, t.name]))

    return (
        <ReferenceDataManager
            title="Ticket Categories"
            description="Classify tickets and auto-apply a default SLA policy and team on creation."
            icon={Tags}
            listPath="/tenant/ticket-categories"
            createPath="/tenant/ticket-categories"
            itemPath={(id) => `/tenant/ticket-categories/${id}`}
            canManage={canManage}
            isPlatform={isPlatform}
            canDelete={false}
            hierarchical
            columns={[
                { key: 'default_sla_policy_id', header: 'Default SLA', render: (r) => r.default_sla_policy_id ? <Badge tone="blue">{slaName[r.default_sla_policy_id] || '—'}</Badge> : '—' },
                { key: 'default_team_id', header: 'Default team', render: (r) => r.default_team_id ? <Badge tone="indigo">{teamName[r.default_team_id] || '—'}</Badge> : '—' },
            ]}
            fields={[
                { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Network Issue' },
                { name: 'description', label: 'Description', type: 'textarea' },
                { name: 'default_sla_policy_id', label: 'Default SLA policy', type: 'select', options: slaOptions, placeholder: '— none —' },
                { name: 'default_team_id', label: 'Default team', type: 'select', options: teamOptions, placeholder: '— none —' },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// Asset types (needs asset categories)
// ---------------------------------------------------------------------------

export function AssetTypesSection({ canManage, isPlatform }) {
    const { get } = useItsmApi()
    const { data, loading, error } = useItsmResource(() => get('/asset-categories'), [get])
    if (loading) return <LoadingSpinner />
    if (error) return <ErrorBanner message={error.message} />

    const catOptions = (data || []).map(c => ({ value: c.id, label: c.name }))
    const catName = Object.fromEntries((data || []).map(c => [c.id, c.name]))

    if (catOptions.length === 0) {
        return <ErrorBanner message="Create at least one Asset Category before adding asset types." />
    }

    return (
        <ReferenceDataManager
            title="Asset Types"
            description="Classes of asset within a category, each with an optional custom-field schema."
            icon={Boxes}
            listPath="/asset-types"
            createPath="/asset-types"
            itemPath={(id) => `/asset-types/${id}`}
            canManage={canManage}
            isPlatform={isPlatform}
            canDelete={false}
            columns={[
                { key: 'category_id', header: 'Category', render: (r) => <Badge tone="purple">{catName[r.category_id] || '—'}</Badge> },
            ]}
            fields={[
                { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Laptop' },
                { name: 'category_id', label: 'Category', type: 'select', required: true, options: catOptions, placeholder: 'Select a category' },
                { name: 'custom_fields_schema', label: 'Custom fields (JSON Schema)', type: 'json', help: 'Defines dynamic fields shown on the asset form. Leave as {} for none.' },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// KB tags
// ---------------------------------------------------------------------------

export function KbTagsSection({ canManage, isPlatform }) {
    return (
        <ReferenceDataManager
            title="KB Tags"
            description="Free-form tags for cross-cutting article labelling."
            icon={Hash}
            listPath="/kb/tags"
            createPath="/kb/tags"
            itemPath={(id) => `/kb/tags/${id}`}
            canManage={canManage}
            isPlatform={isPlatform}
            canDelete
            fields={[
                { name: 'name', label: 'Tag name', required: true, placeholder: 'e.g. how-to' },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// KB categories (per space)
// ---------------------------------------------------------------------------

export function KbCategoriesSection({ canManage, isPlatform }) {
    const { get } = useItsmApi()
    const { data: spaces, loading, error } = useItsmResource(() => get('/kb/spaces'), [get])
    const [spaceId, setSpaceId] = useState('')

    const effectiveSpace = useMemo(() => spaceId || (spaces && spaces[0]?.id) || '', [spaceId, spaces])

    if (loading) return <LoadingSpinner />
    if (error) return <ErrorBanner message={error.message} />
    if (!spaces || spaces.length === 0) {
        return <ErrorBanner message="Create a KB Space first (Knowledge Base ▸ Spaces) before adding categories." />
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-500 dark:text-slate-400">Space:</span>
                <select className="select w-64" value={effectiveSpace} onChange={e => setSpaceId(e.target.value)}>
                    {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
            </div>
            <ReferenceDataManager
                key={effectiveSpace}
                title="KB Categories"
                description="Organize articles within the selected space."
                icon={FolderTree}
                listPath={`/kb/spaces/${effectiveSpace}/categories`}
                createPath={`/kb/spaces/${effectiveSpace}/categories`}
                itemPath={(id) => `/kb/categories/${id}`}
                canManage={canManage}
            isPlatform={isPlatform}
                canDelete
                hierarchical
                fields={[
                    { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Getting Started' },
                    { name: 'description', label: 'Description', type: 'textarea' },
                    { name: 'display_order', label: 'Display order', type: 'number', default: 0 },
                ]}
            />
        </div>
    )
}
