import { Component } from 'react'
import * as Sentry from '@sentry/react'

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { error: null }
    }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error, info) {
        Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } })
    }

    render() {
        if (this.state.error) {
            return (
                <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8 space-y-4">
                        <h1 className="text-lg font-bold text-red-700">Something went wrong</h1>
                        <pre className="text-xs bg-gray-100 rounded p-3 overflow-auto max-h-64 text-gray-700">
                            {this.state.error?.message}
                            {'\n\n'}
                            {this.state.error?.stack}
                        </pre>
                        <button
                            onClick={() => window.location.reload()}
                            className="btn-primary w-full py-2.5"
                        >
                            Reload
                        </button>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}
