import { cloneElement, lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useIam } from '../widget/hooks/useIam'
import { useItsmApi } from '../shared/itsm/useItsmApi'
import { LoadingSpinner } from '../shared/itsm/primitives'
import AuthGuard from '../portal/AuthGuard'
import Login from './pages/Login'
import NoAccess from './pages/NoAccess'
import NotFound from './pages/NotFound'
import Layout from './Layout'

// Route-level code-splitting: each page (and its deps) ships as its own chunk,
// lazy-loaded on navigation — keeps the initial bundle small.
const TicketsPage = lazy(() => import('./pages/TicketsPage'))
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage'))
const AssetsPage = lazy(() => import('./pages/AssetsPage'))
const AssetDetailPage = lazy(() => import('./pages/AssetDetailPage'))
const KnowledgeBasePage = lazy(() => import('./pages/KnowledgeBasePage'))
const KbArticleDetailPage = lazy(() => import('./pages/KbArticleDetailPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'))
// Virtual Agent temporarily disabled (re-enable once the AI provider key is restored)
// const VirtualAgentPage = lazy(() => import('./pages/VirtualAgentPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const MarketplaceOrdersPage = lazy(() => import('./pages/MarketplaceOrdersPage'))
const MarketplaceReturnsPage = lazy(() => import('./pages/MarketplaceReturnsPage'))

const ITSM_ROLES = ['Admin', 'org_admin', 'super_admin']

// Two tiers share this app:
//  - Tenant users: itsm-service resolves their tenant from the JWT — they only
//    ever see their own org's tickets/assets/KB, no switcher needed.
//  - Platform-org users (99Technologies staff): itsm-service has no tenant to
//    resolve from their JWT, so they get a TenantSwitcher (see Layout) to pick
//    one tenant — or "all tenants" for the cross-tenant view — exactly like
//    the embedded /admin/itsm views.
//
// itsm-service decides "platform vs tenant" purely by comparing the JWT's
// org_id to PLATFORM_ORG_ID — NOT by role name — and that constant isn't
// exposed to the frontend. Replicating the role check here would miss
// platform-org admins who don't carry `super_admin` (e.g. plain
// `org_admin`/`admin`), who'd pass a role-list check yet have no tenant.
//
// So instead of guessing, we ask the backend directly: probe a platform-tier
// -only endpoint (GET /platform/tenants, gated by require_platform_support())
// and read whether it succeeds. This is the single source of truth and can't
// drift out of sync with the backend's tiering.
//
// NOTE: don't probe a tenant-data endpoint like /tickets — itsm-service lets
// platform-org users call those too (cross-tenant view), so success there no
// longer implies "tenant-scoped".
function StandaloneGuard({ children }) {
    const { isLoading: iamLoading } = useIam()
    const { get } = useItsmApi(null)
    const [tenantCheck, setTenantCheck] = useState('checking') // 'checking' | 'tenant' | 'platform'

    useEffect(() => {
        if (iamLoading) return
        let cancelled = false
        get('/platform/tenants', { page_size: 1 })
            .then(() => { if (!cancelled) setTenantCheck('platform') })
            .catch(() => { if (!cancelled) setTenantCheck('tenant') })
        return () => { cancelled = true }
    }, [iamLoading, get])

    if (iamLoading || tenantCheck === 'checking') {
        return (
            <div className="flex items-center justify-center h-screen">
                <LoadingSpinner />
            </div>
        )
    }
    return <AuthGuard roles={ITSM_ROLES}>{cloneElement(children, { isPlatformOrg: tenantCheck === 'platform' })}</AuthGuard>
}

export default function App() {
    return (
        <BrowserRouter basename="/itsm">
            <Routes>
                <Route path="/login" element={<Login />} />

                <Route path="/" element={
                    <StandaloneGuard>
                        <Layout />
                    </StandaloneGuard>
                }>
                    <Route index                    element={<TicketsPage />} />
                    <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
                    <Route path="assets"            element={<AssetsPage />} />
                    <Route path="assets/:assetId"   element={<AssetDetailPage />} />
                    <Route path="kb"                element={<KnowledgeBasePage />} />
                    <Route path="kb/:articleId"     element={<KbArticleDetailPage />} />
                    <Route path="reports"           element={<ReportsPage />} />
                    <Route path="incidents"         element={<IncidentsPage />} />
                    {/* <Route path="virtual-agent" element={<VirtualAgentPage />} /> — temporarily disabled */}
                    <Route path="notifications"     element={<NotificationsPage />} />
                    <Route path="marketplace-orders"  element={<MarketplaceOrdersPage />} />
                    <Route path="marketplace-returns" element={<MarketplaceReturnsPage />} />
                    <Route path="admin"             element={<AdminPage />} />
                </Route>

                <Route path="/no-access" element={<NoAccess />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    )
}
