import { Link } from 'react-router-dom'

export default function NotFound() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="text-center space-y-4">
                <p className="text-6xl font-bold text-gray-300">404</p>
                <h1 className="text-xl font-semibold text-gray-700">Page not found</h1>
                <Link to="/" className="inline-block btn-primary">Go home</Link>
            </div>
        </div>
    )
}
