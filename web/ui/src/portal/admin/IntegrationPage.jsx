import { useState } from 'react'
import { useApi } from '../useApi'

const THEMES_BUILT_IN = ['default', 'dark', 'blue', 'green']

function CodeBlock({ code }) {
    const [copied, setCopied] = useState(false)
    const copy = () => {
        navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }
    return (
        <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900">
                <span className="text-xs text-gray-400 dark:text-slate-500">HTML embed code</span>
                <button onClick={copy} className="text-xs text-gray-400 dark:text-slate-500 hover:text-white transition-colors">
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>
            <pre className="bg-gray-950 text-green-400 text-xs p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                {code}
            </pre>
        </div>
    )
}

export default function IntegrationPage() {
    const [title, setTitle]         = useState('IT Support')
    const [appId, setAppId]         = useState('IT')
    const [themeColor, setThemeColor] = useState('#2563eb')
    const [serverUrl, setServerUrl] = useState(window.location.origin.replace(':3000', ':8181'))
    const [showAdvanced, setShowAdvanced] = useState(false)

    const embedCode = `<!-- Project IQ Chat Widget -->
<script>
  window.__IAM_CONFIG__ = {
    url:      'https://id.dev.iam.99technologies.com',
    realm:    '99-iam',
    clientId: 'project-iq',
  };
</script>
<script src="${serverUrl}/glpi-chat-widget.js" defer></script>
<glpi-chat-widget
  title="${title}"
  app-id="${appId}"
  theme-id="${themeColor}"
></glpi-chat-widget>`

    const iframeCode = `<!-- Project IQ Chat (iframe embed) -->
<iframe
  src="${serverUrl}/bot"
  width="100%"
  height="600"
  frameborder="0"
  allow="microphone"
></iframe>`

    return (
        <div className="max-w-3xl space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Integration</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Embed the chat widget on any website</p>
            </div>

            {/* Configurator */}
            <div className="card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Widget configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Widget title</label>
                        <input value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">App ID</label>
                        <input value={appId} onChange={e => setAppId(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Theme colour</label>
                        <div className="flex gap-2 items-center">
                            <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
                                className="h-9 w-14 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer" />
                            <input value={themeColor} onChange={e => setThemeColor(e.target.value)}
                                className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Server URL</label>
                        <input value={serverUrl} onChange={e => setServerUrl(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono" />
                    </div>
                </div>
            </div>

            {/* Web Component embed */}
            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Web Component embed (recommended)</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">Paste this snippet into any HTML page. The widget renders as a floating button.</p>
                <CodeBlock code={embedCode} />
            </div>

            {/* iframe embed */}
            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">iframe embed</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">Use this if Web Components are blocked. The widget renders inside a fixed-size frame.</p>
                <CodeBlock code={iframeCode} />
            </div>

            {/* Quick-start guide */}
            <div className="card p-5 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Quick-start steps</h3>
                {[
                    '1. Copy the embed code above.',
                    '2. Paste it just before </body> in your HTML page.',
                    '3. The <script> tag loads the widget bundle from the Project IQ server.',
                    '4. window.__IAM_CONFIG__ configures the Keycloak SSO so users can log in.',
                    '5. Set app-id to the product name configured in your organisation.',
                ].map((s, i) => (
                    <p key={i} className="text-sm text-gray-600 dark:text-slate-400">{s}</p>
                ))}
            </div>
        </div>
    )
}
