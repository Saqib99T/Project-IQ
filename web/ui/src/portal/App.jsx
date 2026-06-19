import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PortalAuthProvider } from './PortalAuth'
import AuthGuard from './AuthGuard'
import Login from './pages/Login'
import RoleRedirect from './pages/RoleRedirect'
import NotFound from './pages/NotFound'
import NoAccess from './pages/NoAccess'
import OperatorLayout from './operator/Layout'
import QueuePage from './operator/QueuePage'
import SessionsPage from './operator/SessionsPage'
import SessionView from './operator/SessionView'
import ItsmTicketsLayout from './operator/ItsmTicketsLayout'
import AdminLayout from './admin/Layout'
import OverviewPage from './admin/OverviewPage'
import AnalyticsPage from './admin/AnalyticsPage'
import OrgsPage from './admin/OrgsPage'
import HistoryPage from './admin/HistoryPage'
import UsersPage from './admin/UsersPage'
import ConfigPage from './admin/ConfigPage'
import KnowledgeBasePage from './admin/KnowledgeBasePage'
import StudioPage from './admin/StudioPage'
import IntegrationPage from './admin/IntegrationPage'
import ThemesPage from './admin/ThemesPage'
import FirecrawlPage from './admin/FirecrawlPage'
import ObservabilityPage from './admin/ObservabilityPage'
import DiagnosticsPage from './admin/DiagnosticsPage'
import InspectorPage from './admin/InspectorPage'
import RoutingRulesPage from './admin/RoutingRulesPage'
import LiveMonitorPage from './admin/LiveMonitorPage'
import ItsmLayout from './admin/itsm/ItsmLayout'
import ItsmTicketsPage from './admin/itsm/ItsmTicketsPage'
import ItsmTicketDetailPage from './admin/itsm/ItsmTicketDetailPage'
import ItsmAssetsPage from './admin/itsm/ItsmAssetsPage'
import ItsmKnowledgeBasePage from './admin/itsm/ItsmKnowledgeBasePage'
import ItsmReportsPage from './admin/itsm/ItsmReportsPage'
import MemberChatPage from './member/ChatPage'

export default function App() {
    return (
        <BrowserRouter basename="/portal">
          <PortalAuthProvider>
            <Routes>
                {/* Public */}
                <Route path="/login" element={<Login />} />

                {/* Root → role-based redirect */}
                <Route path="/" element={
                    <AuthGuard>
                        <RoleRedirect />
                    </AuthGuard>
                } />

                {/* Operator section — Operator or Admin roles */}
                <Route path="/operator" element={
                    <AuthGuard roles={['Operator', 'Admin', 'super_admin', 'org_admin']}>
                        <OperatorLayout />
                    </AuthGuard>
                }>
                    <Route index                           element={<QueuePage />} />
                    <Route path="queue"                    element={<QueuePage />} />
                    <Route path="sessions"                 element={<SessionsPage />} />
                    <Route path="sessions/:conversationId" element={<SessionView />} />
                    {/* ITSM tickets — operators view/work tickets (reuses the shared ITSM pages) */}
                    <Route path="tickets" element={<ItsmTicketsLayout />}>
                        <Route index               element={<ItsmTicketsPage />} />
                        <Route path=":ticketId"    element={<ItsmTicketDetailPage />} />
                    </Route>
                </Route>

                {/* Admin section — Admin or super_admin */}
                <Route path="/admin" element={
                    <AuthGuard roles={['Admin', 'super_admin', 'org_admin']}>
                        <AdminLayout />
                    </AuthGuard>
                }>
                    {/* All admins */}
                    <Route index                element={<OverviewPage />} />
                    <Route path="analytics"     element={<AnalyticsPage />} />
                    <Route path="orgs"          element={<OrgsPage />} />
                    <Route path="history"       element={<HistoryPage />} />
                    <Route path="users"         element={<UsersPage />} />

                    {/* ITSM — tenant-scoped for org admins, all-tenant for super_admin */}
                    <Route path="itsm" element={<ItsmLayout />}>
                        <Route index                    element={<ItsmTicketsPage />} />
                        <Route path="tickets/:ticketId" element={<ItsmTicketDetailPage />} />
                        <Route path="assets"            element={<ItsmAssetsPage />} />
                        <Route path="kb"                element={<ItsmKnowledgeBasePage />} />
                        <Route path="reports"           element={<ItsmReportsPage />} />
                    </Route>

                    {/* Shared admin + operator routes */}
                    <Route path="monitor"       element={<AuthGuard roles={['Operator', 'Admin', 'super_admin', 'org_admin']}><LiveMonitorPage /></AuthGuard>} />

                    {/* Platform routes — super_admin only */}
                    <Route path="config"        element={<AuthGuard roles={['super_admin']}><ConfigPage /></AuthGuard>} />
                    <Route path="kb"            element={<AuthGuard roles={['super_admin']}><KnowledgeBasePage /></AuthGuard>} />
                    <Route path="studio"        element={<AuthGuard roles={['super_admin']}><StudioPage /></AuthGuard>} />
                    <Route path="integration"   element={<AuthGuard roles={['super_admin']}><IntegrationPage /></AuthGuard>} />
                    <Route path="themes"        element={<AuthGuard roles={['super_admin']}><ThemesPage /></AuthGuard>} />
                    <Route path="firecrawl"     element={<AuthGuard roles={['super_admin']}><FirecrawlPage /></AuthGuard>} />
                    <Route path="observability" element={<AuthGuard roles={['super_admin']}><ObservabilityPage /></AuthGuard>} />
                    <Route path="diagnostics"   element={<AuthGuard roles={['super_admin']}><DiagnosticsPage /></AuthGuard>} />
                    <Route path="inspector"     element={<AuthGuard roles={['super_admin']}><InspectorPage /></AuthGuard>} />
                    <Route path="routing"       element={<AuthGuard roles={['super_admin']}><RoutingRulesPage /></AuthGuard>} />
                </Route>

                {/* Chatbot — User and Bot roles get full access (plus staff). */}
                <Route path="/chat" element={
                    <AuthGuard roles={['User', 'Bot', 'Operator', 'Admin', 'super_admin', 'org_admin']}>
                        <MemberChatPage />
                    </AuthGuard>
                } />

                <Route path="/no-access" element={<NoAccess />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
          </PortalAuthProvider>
        </BrowserRouter>
    )
}
