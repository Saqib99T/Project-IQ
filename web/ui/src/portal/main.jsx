import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { ThemeProvider } from './useTheme'

// Portal-only for now — the widget and itsm-app builds don't report to Sentry
// yet. sendDefaultPii is explicitly false (Sentry's own quickstart defaults
// it to true) since this app handles customer PII — order data, ticket
// content, emails — that shouldn't ride along on error events by default.
Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
})

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ErrorBoundary>
            <ThemeProvider>
                <App />
            </ThemeProvider>
        </ErrorBoundary>
    </StrictMode>
)
