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
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 space-y-6">
                <div className="text-center space-y-1">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl mx-auto flex items-center justify-center text-2xl">
                        🎫
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">ITSM</h1>
                    <p className="text-sm text-slate-500">Project IQ Service Management</p>
                </div>

                <button
                    onClick={() => login({ redirectUri: window.location.origin + '/itsm/' })}
                    disabled={isLoading}
                    className="w-full btn-primary py-3 text-base"
                >
                    {isLoading ? 'Connecting…' : 'Sign in with Project IQ'}
                </button>

                <p className="text-center text-xs text-slate-400">
                    Powered by 99 Technologies
                </p>
            </div>
        </div>
    )
}
