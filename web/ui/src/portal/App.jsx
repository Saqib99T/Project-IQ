import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AuthGuard from './AuthGuard'
import Login from './pages/Login'
import RoleRedirect from './pages/RoleRedirect'
import NotFound from './pages/NotFound'
import NoAccess from './pages/NoAccess'
import OperatorLayout from './operator/Layout'
import QueuePage from './operator/QueuePage'
import SessionsPage from './operator/SessionsPage'
import SessionView from './operator/SessionView'
import AdminLayout from './admin/Layout'
import OverviewPage from './admin/OverviewPage'
import AnalyticsPage from './admin/AnalyticsPage'
import OperatorsPage from './admin/OperatorsPage'
import OrgsPage from './admin/OrgsPage'
import HistoryPage from './admin/HistoryPage'
import UsersPage from './admin/UsersPage'
import MemberChatPage from './member/ChatPage'

export default function App() {
    return (
        <BrowserRouter basename="/portal">
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
                    <AuthGuard roles={['Operator', 'Admin', 'super_admin']}>
                        <OperatorLayout />
                    </AuthGuard>
                }>
                    <Route index                           element={<QueuePage />} />
                    <Route path="queue"                    element={<QueuePage />} />
                    <Route path="sessions"                 element={<SessionsPage />} />
                    <Route path="sessions/:conversationId" element={<SessionView />} />
                </Route>

                {/* Admin section — Admin or super_admin */}
                <Route path="/admin" element={
                    <AuthGuard roles={['Admin', 'super_admin']}>
                        <AdminLayout />
                    </AuthGuard>
                }>
                    <Route index                element={<OverviewPage />} />
                    <Route path="analytics"     element={<AnalyticsPage />} />
                    <Route path="operators"     element={<OperatorsPage />} />
                    <Route path="orgs"          element={<OrgsPage />} />
                    <Route path="history"       element={<HistoryPage />} />
                    <Route path="users"         element={<UsersPage />} />
                </Route>

                {/* Member section */}
                <Route path="/chat" element={
                    <AuthGuard roles={['Member', 'Operator', 'Admin', 'super_admin']}>
                        <MemberChatPage />
                    </AuthGuard>
                } />

                <Route path="/no-access" element={<NoAccess />} />
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    )
}
