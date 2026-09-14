import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
    Building2, Tags, Boxes, Layers, Truck, FolderTree, Hash, Users, ShieldCheck,
    Clock, Gauge, Workflow, Webhook, Wallet, ScrollText, BookOpen, Settings, Lock, FileWarning,
    Info, ChevronDown, ChevronRight, FileText, Package, Siren, Activity, Store,
} from 'lucide-react'
import { useIam } from '../../widget/hooks/useIam'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { cn } from '../../shared/itsm/cn'
import { PageHeader, useToast } from '../../shared/itsm/ui'

// Existing sections
import AutomationRulesSection from '../components/admin/AutomationRulesSection'
import WebhooksSection from '../components/admin/WebhooksSection'
import SlaPoliciesSection from '../components/admin/SlaPoliciesSection'
import SlaAgreementsSection from '../components/admin/SlaAgreementsSection'
import OnCallSection from '../components/admin/OnCallSection'
import SloSection from '../components/admin/SloSection'
import RcaPolicySection from '../components/admin/RcaPolicySection'
import TeamsSection from '../components/admin/TeamsSection'
import KbSpacesSection from '../components/admin/KbSpacesSection'
import KbArticlesSection from '../components/admin/KbArticlesSection'
import BusinessHoursSection from '../components/admin/BusinessHoursSection'
import UserRolesSection from '../components/admin/UserRolesSection'
import AiBudgetSection from '../components/admin/AiBudgetSection'
import AuditLogSection from '../components/admin/AuditLogSection'
import SystemLogsSection from '../components/admin/SystemLogsSection'
import MarketplacesSection from '../components/admin/MarketplacesSection'
// New reference-data sections
import {
    DepartmentsSection, ProductsSection, AssetCategoriesSection, AssetTypesSection, VendorsSection,
    TicketCategoriesSection, KbTagsSection, KbCategoriesSection,
} from '../components/admin/ReferenceDataSections'

// id, label, icon, render(ctx), adminOnly?
const GROUPS = [
    {
        id: 'organization', label: 'Organization',
        items: [
            { id: 'departments', label: 'Departments', icon: Building2, render: (c) => <DepartmentsSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
            { id: 'products', label: 'Products', icon: Package, render: (c) => <ProductsSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
        ],
    },
    {
        id: 'service-catalog', label: 'Service Catalog',
        items: [
            { id: 'ticket-categories', label: 'Ticket Categories', icon: Tags, render: (c) => <TicketCategoriesSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
            { id: 'sla-agreements', label: 'SLA / OLA / UC', icon: Gauge, adminOnly: true, tenantScoped: true, render: () => <SlaAgreementsSection /> },
            { id: 'sla', label: 'SLA Policies (legacy)', icon: Gauge, tenantScoped: true, render: () => <SlaPoliciesSection /> },
            { id: 'business-hours', label: 'Business Hours', icon: Clock, adminOnly: true, tenantScoped: true, render: () => <BusinessHoursSection /> },
        ],
    },
    {
        id: 'oncall-sre', label: 'On-Call & SRE',
        items: [
            { id: 'oncall', label: 'On-Call / Escalation', icon: Siren, adminOnly: true, tenantScoped: true, render: () => <OnCallSection /> },
            { id: 'reliability', label: 'Reliability (SLO)', icon: Activity, adminOnly: true, tenantScoped: true, render: () => <SloSection /> },
            { id: 'rca-policies', label: 'RCA Governance', icon: FileWarning, adminOnly: false, tenantScoped: true, render: () => <RcaPolicySection /> },
        ],
    },
    {
        id: 'asset-config', label: 'Asset Configuration',
        items: [
            { id: 'asset-categories', label: 'Asset Categories', icon: Layers, render: (c) => <AssetCategoriesSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
            { id: 'asset-types', label: 'Asset Types', icon: Boxes, render: (c) => <AssetTypesSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
            { id: 'vendors', label: 'Vendors', icon: Truck, render: (c) => <VendorsSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
        ],
    },
    {
        id: 'knowledge-base', label: 'Knowledge Base',
        items: [
            { id: 'kb-articles', label: 'Articles', icon: FileText, render: () => <KbArticlesSection /> },
            { id: 'kb-spaces', label: 'Spaces', icon: BookOpen, adminOnly: true, render: () => <KbSpacesSection /> },
            { id: 'kb-categories', label: 'Categories', icon: FolderTree, tenantScoped: true, render: (c) => <KbCategoriesSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
            { id: 'kb-tags', label: 'Tags', icon: Hash, tenantScoped: true, render: (c) => <KbTagsSection canManage={c.isManager} isPlatform={c.isPlatform} /> },
        ],
    },
    {
        id: 'people-access', label: 'People & Access',
        items: [
            { id: 'teams', label: 'Teams', icon: Users, tenantScoped: true, render: () => <TeamsSection /> },
            { id: 'user-roles', label: 'User', icon: ShieldCheck, adminOnly: true, tenantScoped: true, render: () => <UserRolesSection /> },
        ],
    },
    {
        id: 'automation', label: 'Automation',
        items: [
            { id: 'automation-rules', label: 'Automation Rules', icon: Workflow, adminOnly: true, tenantScoped: true, render: () => <AutomationRulesSection /> },
            { id: 'webhooks', label: 'Webhooks', icon: Webhook, adminOnly: true, tenantScoped: true, render: () => <WebhooksSection /> },
        ],
    },
    {
        id: 'marketplaces', label: 'Marketplaces',
        items: [
            { id: 'marketplaces', label: 'Connections', icon: Store, adminOnly: true, tenantScoped: true, render: () => <MarketplacesSection /> },
        ],
    },
    {
        id: 'platform-ai', label: 'Platform & AI',
        items: [
            { id: 'ai-budget', label: 'AI Budget', icon: Wallet, adminOnly: true, tenantScoped: true, render: () => <AiBudgetSection /> },
            { id: 'audit-log', label: 'Audit Log', icon: ScrollText, adminOnly: true, tenantScoped: true, render: () => <AuditLogSection /> },
            { id: 'system-logs', label: 'System Logs', icon: FileWarning, adminOnly: true, tenantScoped: true, render: () => <SystemLogsSection /> },
        ],
    },
]

const ADMIN_ROLE_NAMES = ['admin', 'Admin', 'org_admin', 'super_admin']
const MANAGER_ROLE_NAMES = ['manager', ...ADMIN_ROLE_NAMES]

// Matches registry.py / MarketplacesSection.jsx's PROVIDERS — used to notice
// a landing from itsm-service's OAuth callback redirects (?connected=shopify
// or ?shopify_error=...), which always land here since itsm-service has no
// frontend of its own to redirect to directly (see marketplace_shopify.py's
// callback docstring, 2026-09-14).
const MARKETPLACE_PROVIDERS = ['shopify', 'amazon', 'walmart', 'ebay', 'etsy']

// One-time read of the landing query string — used both for the initial
// activeId/openGroups state and the toast effect below. A function (not a
// module constant) so it re-reads window.location.search fresh on every
// mount rather than caching a stale value across client-side navigations.
function readMarketplaceLanding() {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected')
    if (connected && MARKETPLACE_PROVIDERS.includes(connected)) {
        return { provider: connected, ok: true }
    }
    for (const p of MARKETPLACE_PROVIDERS) {
        const err = params.get(`${p}_error`)
        if (err) return { provider: p, ok: false, error: err }
    }
    return null
}

export default function AdminPage() {
    const { user } = useIam()
    const { isPlatformOrg } = useOutletContext() || {}
    const { tenantId } = useItsmTenant()
    const { toast } = useToast()
    const roles = user?.realm_roles || []
    // Platform-org users administer any tenant; tenant users need an itsm
    // manager/admin role (realm_roles carry IAM names, so accept both).
    const isAdmin = isPlatformOrg || roles.some(r => ADMIN_ROLE_NAMES.includes(r))
    const isManager = isPlatformOrg || roles.some(r => MANAGER_ROLE_NAMES.includes(r))
    const ctx = { isAdmin, isManager, isPlatform: !!isPlatformOrg }
    // Tenant-scoped admin needs a tenant context; platform users in the
    // "All tenants" view must pick one in the top-bar switcher first.
    const needsTenantPick = isPlatformOrg && tenantId === null

    const allItems = useMemo(() => GROUPS.flatMap(g => g.items.map(it => ({ ...it, group: g.label }))), [])
    // Landing from an itsm-service OAuth callback (?connected=shopify or
    // ?shopify_error=...) should open straight to Marketplaces instead of
    // the Departments default — otherwise the connect/error feedback below
    // fires on a section the user isn't even looking at.
    const [activeId, setActiveId] = useState(() => (readMarketplaceLanding() ? 'marketplaces' : 'departments'))
    const active = allItems.find(it => it.id === activeId) || allItems[0]

    const groupOf = (itemId) => GROUPS.find(g => g.items.some(it => it.id === itemId))?.id
    // Accordion: only the group holding the active item starts expanded.
    const [openGroups, setOpenGroups] = useState(() => new Set([groupOf(activeId)]))

    // Fires once on mount: toast the OAuth callback's outcome, then strip the
    // query string so a page refresh doesn't re-fire the same toast.
    useEffect(() => {
        const landing = readMarketplaceLanding()
        if (!landing) return
        if (landing.ok) {
            toast(`${landing.provider[0].toUpperCase()}${landing.provider.slice(1)} connected`, 'success')
        } else {
            toast(`${landing.provider} connection failed: ${landing.error}`, 'error')
        }
        window.history.replaceState({}, '', window.location.pathname)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const toggleGroup = (gid) => setOpenGroups(prev => {
        const next = new Set(prev)
        next.has(gid) ? next.delete(gid) : next.add(gid)
        return next
    })
    const selectItem = (it) => { setActiveId(it.id); setOpenGroups(prev => new Set(prev).add(groupOf(it.id))) }

    if (!isManager) {
        return (
            <div className="max-w-2xl mx-auto">
                <div className="card p-8 text-center space-y-2">
                    <Lock className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        You need a <span className="font-medium">manager</span> or <span className="font-medium">admin</span> ITSM role to view administration.
                    </p>
                </div>
            </div>
        )
    }

    const restricted = active.adminOnly && !isAdmin
    // Per-tenant sections can't operate in the cross-tenant "All tenants" view —
    // prompt the platform user to pick a tenant rather than letting the call 500.
    const tenantBlocked = needsTenantPick && active.tenantScoped

    return (
        <div className="space-y-5">
            <PageHeader
                title="Administration"
                subtitle="Configure reference data, access, automation and platform settings."
                icon={Settings}
            />

            {needsTenantPick && (
                <div className="card p-4 flex items-start gap-2.5 bg-primary/10 border-primary/20">
                    <Info className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                    <p className="text-sm text-primary">
                        <span className="font-medium">All tenants view.</span> Reference data you create here is <span className="font-medium">Global</span> — shared by every tenant. To manage a single tenant's own data instead, pick that tenant in the top-bar switcher.
                    </p>
                </div>
            )}

            <div className="flex gap-5 items-start">
                {/* Left rail — collapsible accordion groups */}
                <nav className="w-64 shrink-0 sticky top-0">
                    <div className="card p-1.5 space-y-0.5">
                        {GROUPS.map(group => {
                            const open = openGroups.has(group.id)
                            const hasActive = group.items.some(it => it.id === activeId)
                            return (
                                <div key={group.id}>
                                    <button
                                        onClick={() => toggleGroup(group.id)}
                                        className={cn(
                                            'w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors',
                                            hasActive && !open
                                                ? 'text-primary'
                                                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50',
                                        )}
                                    >
                                        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                                        <span className="flex-1 text-left truncate">{group.label}</span>
                                    </button>
                                    {open && (
                                        <div className="space-y-0.5 pb-1 pl-2">
                                            {group.items.map(it => {
                                                const locked = it.adminOnly && !isAdmin
                                                const isActive = it.id === activeId
                                                return (
                                                    <button
                                                        key={it.id}
                                                        onClick={() => selectItem(it)}
                                                        title={locked ? 'Requires the admin role' : undefined}
                                                        className={cn(
                                                            'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                                                            isActive
                                                                ? 'bg-primary/10 text-primary font-medium'
                                                                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                                                        )}
                                                    >
                                                        <it.icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                                                        <span className="flex-1 text-left truncate">{it.label}</span>
                                                        {locked && <Lock className="w-3 h-3 text-slate-300 dark:text-slate-600" />}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </nav>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {restricted ? (
                        <div className="card p-8 text-center space-y-2">
                            <Lock className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                            <p className="text-sm text-slate-600 dark:text-slate-300">This section requires the <span className="font-medium">admin</span> ITSM role.</p>
                        </div>
                    ) : tenantBlocked ? (
                        <div className="card p-8 text-center space-y-2">
                            <Building2 className="w-8 h-8 mx-auto text-fgsubtle" />
                            <p className="text-sm font-medium text-fg">Select a tenant</p>
                            <p className="text-sm text-fgmuted max-w-md mx-auto">
                                <span className="font-medium">{active.label}</span> is a per-tenant setting. Pick a tenant in the
                                top-bar switcher to manage it — there's no cross-tenant "all tenants" view for this section.
                            </p>
                        </div>
                    ) : (
                        active.render(ctx)
                    )}
                </div>
            </div>
        </div>
    )
}
