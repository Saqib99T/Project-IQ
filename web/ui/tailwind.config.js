/** @type {import('tailwindcss').Config} */
// Colors are driven by CSS variables (see src/portal/index.css theme blocks) so
// the whole UI can switch between the "Project IQ" and "99 Technologies" brand
// themes (each with light + dark) at runtime via the [data-theme] attribute.
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`

export default {
    darkMode: 'class',
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Brand accent (themed)
                primary: {
                    DEFAULT: rgb('--c-primary'),
                    fg:      rgb('--c-primary-fg'),
                    soft:    rgb('--c-primary-soft'),
                },
                accentfrom: rgb('--c-accent-from'),
                accentto:   rgb('--c-accent-to'),
                // Surfaces & text (themed)
                bg:       rgb('--c-bg'),
                surface:  rgb('--c-surface'),
                surface2: rgb('--c-surface-2'),
                fg:       rgb('--c-fg'),
                fgmuted:  rgb('--c-fg-muted'),
                fgsubtle: rgb('--c-fg-subtle'),
                bordc:    rgb('--c-border'),
                bordstrong: rgb('--c-border-strong'),
                sidebar:  rgb('--c-sidebar'),
                sidebarfg: rgb('--c-sidebar-fg'),
                // Semantic (themed)
                info:     rgb('--c-info'),
                success:  rgb('--c-success'),
                warning:  rgb('--c-warning'),
                danger:   rgb('--c-danger'),
                // Keep legacy names so any un-migrated usage still resolves
                secondary: "#64748b",
                accent: "#f59e0b",
            },
            fontFamily: {
                sans:    'var(--font-sans)',
                heading: 'var(--font-heading)',
            },
        },
    },
    plugins: [],
}
