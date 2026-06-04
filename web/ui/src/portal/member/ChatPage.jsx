import { useIam } from '../../widget/hooks/useIam'

/**
 * Full-page chat for portal members.
 * Embeds the widget in an iframe; passes product context via hash so the
 * widget can pre-select an entitlement when IAM user has multiple apps.
 * Phase 8: Phase 9+ will embed ChatWindow directly (no iframe overhead).
 */
export default function MemberChatPage() {
    const { user, logout } = useIam()

    // Pick the first app if only one, otherwise let the widget show the selector
    const productHint = user?.apps?.length === 1 ? user.apps[0] : null
    const botSrc = productHint ? `/bot?product=${encodeURIComponent(productHint)}` : '/bot'

    return (
        <div className="flex h-screen flex-col bg-gray-900">
            {/* Mini top bar */}
            <header className="h-12 bg-gray-800 flex items-center px-4 gap-3 shrink-0">
                <span className="text-white text-sm font-medium">Project IQ</span>
                <span className="text-gray-400 text-xs">·</span>
                <span className="text-gray-300 text-xs">{user?.name || user?.email}</span>
                {productHint && (
                    <>
                        <span className="text-gray-400 text-xs">·</span>
                        <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">
                            {productHint.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                    </>
                )}
                <button
                    onClick={() => logout({ redirectUri: window.location.origin + '/portal/login' })}
                    className="ml-auto text-xs text-gray-400 hover:text-white transition-colors"
                >
                    Sign out
                </button>
            </header>

            {/* Chat embed */}
            <div className="flex-1 relative">
                <iframe
                    src={botSrc}
                    className="absolute inset-0 w-full h-full border-0"
                    title="Project IQ Chat"
                    allow="microphone"
                />
            </div>
        </div>
    )
}
