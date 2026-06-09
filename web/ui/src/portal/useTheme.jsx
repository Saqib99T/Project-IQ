/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)
const STORAGE_KEY = 'portal-theme'
const BRAND_KEY = 'portal-brand'

const BRANDS = ['iq', '99t']

const getInitialTheme = () => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const getInitialBrand = () => {
    const stored = localStorage.getItem(BRAND_KEY)
    return BRANDS.includes(stored) ? stored : 'iq'
}

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(getInitialTheme)
    const [brand, setBrand] = useState(getInitialBrand)

    useEffect(() => {
        const root = document.documentElement
        root.classList.toggle('dark', theme === 'dark')
        localStorage.setItem(STORAGE_KEY, theme)
    }, [theme])

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', brand)
        localStorage.setItem(BRAND_KEY, brand)
    }, [brand])

    const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
    const toggleBrand = () => setBrand(b => (b === 'iq' ? '99t' : 'iq'))

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, brand, setBrand, toggleBrand }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
    return ctx
}

/** Brand metadata for switcher UIs. */
export const BRAND_META = {
    iq:   { label: 'Project IQ',      swatch: '#4f46e5' },
    '99t':{ label: '99 Technologies', swatch: '#00a76f' },
}
