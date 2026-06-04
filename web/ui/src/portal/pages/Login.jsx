import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIam } from '../../widget/hooks/useIam'

export default function Login() {
    const { isAuthenticated, isLoading, login } = useIam()
    const navigate = useNavigate()

    useEffect(() => {
        if (!isLoading && isAuthenticated) navigate('/', { replace: true })
    }, [isAuthenticated, isLoading, navigate])

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 space-y-6">
                {/* Logo / Brand */}
                <div className="text-center space-y-1">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center">
                        <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Project IQ</h1>
                    <p className="text-sm text-gray-500">Operator & Admin Portal</p>
                </div>

                <button
                    onClick={() => login({ redirectUri: window.location.origin + '/portal/' })}
                    disabled={isLoading}
                    className="w-full btn-primary py-3 text-base"
                >
                    {isLoading ? 'Connecting…' : 'Sign in with Project IQ'}
                </button>

                <p className="text-center text-xs text-gray-400">
                    Powered by 99 Technologies
                </p>
            </div>
        </div>
    )
}
