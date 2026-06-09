import { useEffect, useRef, useState } from 'react'
import { Moon, Sun, Check, Palette } from 'lucide-react'
import { useTheme, BRAND_META } from './useTheme'

// Shared appearance menu: brand (Project IQ / 99 Technologies) + dark mode,
// in one dropdown. Used across the portal (admin, operator) and ITSM app.
export default function AppearanceMenu() {
    const { brand, setBrand, theme, toggleTheme } = useTheme()
    const dark = theme === 'dark'
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
    }, [open])

    const activeSwatch = BRAND_META[brand]?.swatch

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-label="Appearance settings"
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-bordc bg-surface
                           text-fgmuted hover:text-fg hover:bg-surface2 transition-colors"
            >
                <Palette className="w-4 h-4" />
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeSwatch }} />
                {dark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>

            {open && (
                <div role="menu" className="absolute right-0 mt-2 w-60 rounded-2xl border border-bordc bg-surface shadow-xl p-2 z-50 origin-top-right">
                    <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fgsubtle">Theme</p>
                    {Object.entries(BRAND_META).map(([key, meta]) => (
                        <button
                            key={key}
                            role="menuitemradio"
                            aria-checked={brand === key}
                            onClick={() => { setBrand(key); setOpen(false) }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition-colors ${
                                brand === key ? 'bg-primary/10 text-primary font-medium' : 'text-fg hover:bg-surface2'
                            }`}
                        >
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: meta.swatch }} />
                            <span className="flex-1 text-left">{meta.label}</span>
                            {brand === key && <Check className="w-4 h-4 shrink-0" />}
                        </button>
                    ))}

                    <div className="my-1.5 border-t border-bordc" />

                    <button
                        role="menuitemcheckbox"
                        aria-checked={dark}
                        onClick={toggleTheme}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-fg hover:bg-surface2 transition-colors"
                    >
                        {dark ? <Moon className="w-4 h-4 shrink-0 text-primary" /> : <Sun className="w-4 h-4 shrink-0 text-amber-500" />}
                        <span className="flex-1 text-left">Dark mode</span>
                        <span className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors ${dark ? 'bg-primary' : 'bg-bordstrong'}`}>
                            <span className={`absolute w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200 ${dark ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                        </span>
                    </button>
                </div>
            )}
        </div>
    )
}
