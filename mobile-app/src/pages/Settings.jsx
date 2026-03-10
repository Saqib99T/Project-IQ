import React, { useState, useEffect } from 'react';
import { ArrowLeft, Server, Check, AlertCircle, Wifi } from 'lucide-react';
import { motion } from 'framer-motion';
import { getApiUrl, setApiUrl, WEBHOOK_PATH } from '../config';

const Settings = ({ onBack }) => {
    const [url, setUrl] = useState('');
    const [status, setStatus] = useState(null); // 'testing' | 'success' | 'error'
    const [statusMessage, setStatusMessage] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        (async () => {
            const currentUrl = await getApiUrl();
            setUrl(currentUrl);
        })();
    }, []);

    const handleTest = async () => {
        if (!url.trim()) return;
        setStatus('testing');
        setStatusMessage('Testing connection...');
        setSaved(false);

        try {
            const testUrl = `${url.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
            const response = await fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: 'test', message: '/greet' }),
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                setStatus('success');
                setStatusMessage('Connected successfully!');
            } else {
                setStatus('error');
                setStatusMessage(`Server returned ${response.status}`);
            }
        } catch (error) {
            setStatus('error');
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                setStatusMessage('Connection timed out. Is the server running?');
            } else {
                setStatusMessage('Cannot connect. Check the URL and ensure the server is reachable.');
            }
        }
    };

    const handleSave = async () => {
        const cleanUrl = url.replace(/\/+$/, '');
        setUrl(cleanUrl);
        await setApiUrl(cleanUrl);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="h-screen w-screen flex flex-col bg-white safe-area-inset">
            {/* Header */}
            <div className="px-4 py-3 flex items-center gap-3 bg-white border-b border-gray-100 safe-area-top">
                <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600">
                    <ArrowLeft size={20} />
                </button>
                <h1 className="font-semibold text-lg text-gray-900">Settings</h1>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Server Configuration */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-gray-50 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
                            <Server size={20} className="text-white" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-gray-900">Rasa Server</h2>
                            <p className="text-xs text-gray-500">Configure your chatbot backend URL</p>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Server URL</label>
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => { setUrl(e.target.value); setStatus(null); setSaved(false); }}
                            placeholder="http://192.168.1.100:5005"
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 text-base bg-white"
                        />
                        <p className="mt-2 text-xs text-gray-400">
                            Enter your Rasa server's IP address and port. For local testing, use your computer's LAN IP (not localhost).
                        </p>
                    </div>

                    {/* Status indicator */}
                    {status && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className={`flex items-center gap-2 p-3 rounded-xl text-sm ${status === 'testing' ? 'bg-yellow-50 text-yellow-700' :
                                    status === 'success' ? 'bg-green-50 text-green-700' :
                                        'bg-red-50 text-red-700'
                                }`}>
                            {status === 'testing' && <Wifi size={16} className="animate-pulse" />}
                            {status === 'success' && <Check size={16} />}
                            {status === 'error' && <AlertCircle size={16} />}
                            <span>{statusMessage}</span>
                        </motion.div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-3">
                        <button onClick={handleTest}
                            className="flex-1 px-4 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors text-sm">
                            🔌 Test Connection
                        </button>
                        <button onClick={handleSave}
                            className={`flex-1 px-4 py-3 font-medium rounded-xl transition-all text-sm text-white ${saved ? 'bg-green-500' : 'bg-black hover:bg-gray-800'
                                }`}>
                            {saved ? '✓ Saved!' : '💾 Save'}
                        </button>
                    </div>
                </motion.div>

                {/* Help Section */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                    className="bg-blue-50 rounded-2xl p-5 space-y-3">
                    <h3 className="font-semibold text-blue-900">💡 How to find your server URL</h3>
                    <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
                        <li>Open a terminal on the machine running Rasa</li>
                        <li>Run <code className="bg-blue-100 px-1 rounded">ipconfig</code> (Windows) or <code className="bg-blue-100 px-1 rounded">ifconfig</code> (Mac/Linux)</li>
                        <li>Find your IPv4 address (e.g., 192.168.1.100)</li>
                        <li>Enter <code className="bg-blue-100 px-1 rounded">http://192.168.1.100:5005</code></li>
                        <li>Make sure your phone is on the same WiFi network</li>
                    </ol>
                </motion.div>

                {/* App Info */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                    className="text-center text-xs text-gray-400 py-4">
                    <p>Project IQ Mobile v1.0.0</p>
                    <p className="mt-1">Powered by Rasa</p>
                </motion.div>
            </div>
        </div>
    );
};

export default Settings;
