import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../portal/index.css'
import App from './App'
import ErrorBoundary from '../portal/ErrorBoundary'
import { ThemeProvider } from '../portal/useTheme'

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ErrorBoundary>
            <ThemeProvider>
                <App />
            </ThemeProvider>
        </ErrorBoundary>
    </StrictMode>
)
