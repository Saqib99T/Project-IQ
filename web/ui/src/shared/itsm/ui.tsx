/* eslint-disable react-refresh/only-export-components */
/**
 * ITSM design-system primitives — the professional component layer shared by
 * the standalone ITSM app and embedded admin views. Built on Tailwind +
 * lucide-react. Pairs with the simpler presentational helpers in primitives.jsx
 * (StatusBadge, cards, etc.), which remain for backwards compatibility.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import {
    X, Search, ChevronRight, ChevronDown, ChevronUp, AlertTriangle,
    CheckCircle2, Info, XCircle, ChevronLeft, type LucideIcon,
} from 'lucide-react'
import { cn } from './cn'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
type BtnSize = 'xs' | 'sm' | 'md'

const BTN_VARIANTS: Record<BtnVariant, string> = {
    primary: 'bg-gradient-to-r from-accentfrom to-accentto text-primary-fg shadow-sm hover:shadow-md hover:brightness-105',
    secondary: 'bg-surface text-fg border border-bordc hover:bg-surface2',
    ghost: 'text-fgmuted hover:bg-surface2',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/30',
    'danger-ghost': 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10',
}

const BTN_SIZES: Record<BtnSize, string> = {
    xs: 'px-2.5 py-1 text-xs gap-1',
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: BtnVariant
    size?: BtnSize
    icon?: LucideIcon
}

export function Button({ variant = 'primary', size = 'md', icon: Icon, className, children, ...props }: ButtonProps) {
    return (
        <button
            className={cn(
                'inline-flex items-center justify-center rounded-xl font-medium transition-all',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
                BTN_VARIANTS[variant], BTN_SIZES[size], className,
            )}
            {...props}
        >
            {Icon && <Icon className={size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'} strokeWidth={2} />}
            {children}
        </button>
    )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: LucideIcon
    label: string
    size?: 'sm' | 'md'
}

export function IconButton({ icon: Icon, label, className, size = 'md', ...props }: IconButtonProps) {
    const dim = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9'
    return (
        <button
            aria-label={label}
            title={label}
            className={cn(
                'inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100',
                'dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors',
                dim, className,
            )}
            {...props}
        >
            {Icon && <Icon className="w-4 h-4" strokeWidth={2} />}
        </button>
    )
}

// ---------------------------------------------------------------------------
// Badge (semantic)
// ---------------------------------------------------------------------------

type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'indigo' | 'purple'

const BADGE_TONES: Record<BadgeTone, string> = {
    gray: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    green: 'bg-green-100 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
}

export function Badge({ tone = 'gray', icon: Icon, className, children }: {
    tone?: BadgeTone
    icon?: LucideIcon
    className?: string
    children?: ReactNode
}) {
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium', BADGE_TONES[tone] || BADGE_TONES.gray, className)}>
            {Icon && <Icon className="w-3 h-3" strokeWidth={2.5} />}
            {children}
        </span>
    )
}

// ---------------------------------------------------------------------------
// Drawer — slide-in panel for create/edit forms
// ---------------------------------------------------------------------------

export interface DrawerProps {
    open: boolean
    onClose?: () => void
    title?: ReactNode
    description?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    width?: string
}

export function Drawer({ open, onClose, title, description, children, footer, width = 'max-w-md' }: DrawerProps) {
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    if (!open) return null
    return createPortal(
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] animate-[fadeIn_.15s_ease]" onClick={onClose} />
            <div className={cn(
                'absolute right-0 top-0 h-full w-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col',
                'border-l border-slate-200 dark:border-slate-800 animate-[slideInRight_.2s_ease]', width,
            )}>
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{title}</h3>
                        {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
                    </div>
                    <IconButton icon={X} label="Close" onClick={onClose} size="sm" />
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
                {footer && <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">{footer}</div>}
            </div>
        </div>,
        document.body,
    )
}

// ---------------------------------------------------------------------------
// Tabs — pill navigation
// ---------------------------------------------------------------------------

export interface TabItem {
    id: string
    label: ReactNode
    icon?: LucideIcon
    count?: number
}

export function Tabs({ tabs, value, onChange, className }: {
    tabs: TabItem[]
    value: string
    onChange: (id: string) => void
    className?: string
}) {
    return (
        <div className={cn('flex items-center gap-1 flex-wrap', className)}>
            {tabs.map((t) => {
                const active = t.id === value
                const Icon = t.icon
                return (
                    <button
                        key={t.id}
                        onClick={() => onChange(t.id)}
                        className={cn(
                            'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            active
                                ? 'bg-primary/10 text-primary'
                                : 'text-fgsubtle hover:text-fg hover:bg-surface2',
                        )}
                    >
                        {Icon && <Icon className="w-4 h-4" strokeWidth={2} />}
                        {t.label}
                        {t.count != null && (
                            <span className={cn('ml-0.5 px-1.5 rounded text-[11px]', active ? 'bg-primary/20 text-primary' : 'bg-surface2 text-fgmuted')}>{t.count}</span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

// ---------------------------------------------------------------------------
// DataTable — sortable, dense, clickable rows
// ---------------------------------------------------------------------------

export interface SortState {
    key: string
    dir: 'asc' | 'desc'
}

export interface DataTableColumn<T> {
    key: string
    header: ReactNode
    render?: (row: T) => ReactNode
    sortable?: boolean
    className?: string
    width?: string | number
}

export interface DataTableProps<T> {
    columns: DataTableColumn<T>[]
    rows: T[]
    rowKey?: keyof T
    onRowClick?: (row: T) => void
    sort?: SortState
    onSortChange?: (sort: SortState) => void
    empty?: ReactNode
    loading?: boolean
    indent?: (row: T) => number
}

export function DataTable<T extends Record<string, unknown>>({
    columns, rows, rowKey = 'id' as keyof T, onRowClick, sort, onSortChange, empty = 'No records found.', loading, indent,
}: DataTableProps<T>) {
    const handleSort = (col: DataTableColumn<T>) => {
        if (!col.sortable || !onSortChange) return
        if (sort?.key === col.key) onSortChange({ key: col.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
        else onSortChange({ key: col.key, dir: 'asc' })
    }
    return (
        <div className="card overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead>
                        <tr>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    style={col.width ? { width: col.width } : undefined}
                                    onClick={() => handleSort(col)}
                                    className={cn(
                                        'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500',
                                        'border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30',
                                        col.sortable && 'cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300',
                                        col.className,
                                    )}
                                >
                                    <span className="inline-flex items-center gap-1">
                                        {col.header}
                                        {sort?.key === col.key && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i}>
                                    {columns.map((c) => (
                                        <td key={c.key} className="px-4 py-3 border-b border-slate-50 dark:border-slate-800/60">
                                            <div className="h-3.5 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">{empty}</td></tr>
                        ) : (
                            rows.map((row) => (
                                <tr
                                    key={String(row[rowKey])}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={cn(
                                        'border-b border-slate-50 dark:border-slate-800/60 transition-colors',
                                        onRowClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40',
                                    )}
                                >
                                    {columns.map((col, ci) => (
                                        <td key={col.key} className={cn('px-4 py-3 text-slate-700 dark:text-slate-300', col.className)}>
                                            {ci === 0 && indent ? (
                                                <span style={{ paddingLeft: `${(indent(row) || 0) * 18}px` }} className="inline-flex items-center gap-1">
                                                    {indent(row) > 0 && <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" />}
                                                    {col.render ? col.render(row) : String(row[col.key] ?? '')}
                                                </span>
                                            ) : (
                                                col.render ? col.render(row) : String(row[col.key] ?? '')
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// SearchInput
// ---------------------------------------------------------------------------

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
}) {
    return (
        <div className={cn('relative', className)}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" strokeWidth={2} />
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="input pl-9"
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// FilterBar — toolbar wrapper above tables/lists
// ---------------------------------------------------------------------------

export function FilterBar({ children, className }: { children?: ReactNode; className?: string }) {
    return <div className={cn('flex items-center gap-2 flex-wrap', className)}>{children}</div>
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

export interface BreadcrumbItem {
    label: ReactNode
    onClick?: () => void
    to?: string
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
    return (
        <nav className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            {items.map((it, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />}
                    {it.onClick || it.to ? (
                        <button onClick={it.onClick} className="hover:text-slate-800 dark:hover:text-slate-200 transition-colors">{it.label}</button>
                    ) : (
                        <span className={i === items.length - 1 ? 'text-slate-800 dark:text-slate-200 font-medium' : ''}>{it.label}</span>
                    )}
                </span>
            ))}
        </nav>
    )
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

export function PageHeader({ title, subtitle, breadcrumb, actions, icon: Icon }: {
    title: ReactNode
    subtitle?: ReactNode
    breadcrumb?: BreadcrumbItem[]
    actions?: ReactNode
    icon?: LucideIcon
}) {
    return (
        <div className="space-y-2">
            {breadcrumb && <Breadcrumb items={breadcrumb} />}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                    {Icon && (
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Icon className="w-5 h-5 text-primary" strokeWidth={2} />
                        </div>
                    )}
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">{title}</h1>
                        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
                    </div>
                </div>
                {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
    return <div className={cn('rounded bg-slate-100 dark:bg-slate-800 animate-pulse', className)} />
}

// ---------------------------------------------------------------------------
// Pagination (cursor or page based)
// ---------------------------------------------------------------------------

export function Pagination({ onPrev, onNext, hasPrev, hasNext, label }: {
    onPrev?: () => void
    onNext?: () => void
    hasPrev?: boolean
    hasNext?: boolean
    label?: ReactNode
}) {
    return (
        <div className="flex items-center justify-between gap-3 pt-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
            <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={onPrev} disabled={!hasPrev}>Prev</Button>
                <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext}>Next<ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Toast system
// ---------------------------------------------------------------------------

type ToastType = 'success' | 'error' | 'info' | 'warning'
interface ToastEntry { id: string; message: ReactNode; type: ToastType }
interface ToastContextValue { toast: (message: ReactNode, type?: ToastType) => void }

const ToastContext = createContext<ToastContextValue | null>(null)
const TOAST_ICON: Record<ToastType, LucideIcon> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }
const TOAST_TONE: Record<ToastType, string> = {
    success: 'border-green-200 dark:border-emerald-500/30 text-green-700 dark:text-emerald-300',
    error: 'border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300',
    info: 'border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-300',
    warning: 'border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext)
    if (!ctx) return { toast: () => {} }
    return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastEntry[]>([])
    const toast = useCallback((message: ReactNode, type: ToastType = 'success') => {
        const id = Math.random().toString(36).slice(2)
        setToasts((t) => [...t, { id, message, type }])
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
    }, [])

    return (
        <ToastContext.Provider value={{ toast }}>
            {children}
            {createPortal(
                <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80">
                    {toasts.map((t) => {
                        const Icon = TOAST_ICON[t.type] || Info
                        return (
                            <div key={t.id} className={cn('card border px-4 py-3 flex items-start gap-2.5 text-sm animate-[slideInRight_.2s_ease]', TOAST_TONE[t.type])}>
                                <Icon className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
                                <span className="flex-1 text-slate-700 dark:text-slate-200">{t.message}</span>
                            </div>
                        )
                    })}
                </div>,
                document.body,
            )}
        </ToastContext.Provider>
    )
}

// ---------------------------------------------------------------------------
// ConfirmDialog (provider + useConfirm hook)
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
    title?: ReactNode
    message?: ReactNode
    danger?: boolean
    cancelLabel?: ReactNode
    confirmLabel?: ReactNode
}
type ConfirmFn = (opts: string | ConfirmOptions) => Promise<boolean>
interface ConfirmContextValue { confirm: ConfirmFn }

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext)
    if (!ctx) return async () => window.confirm('Are you sure?')
    return ctx.confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<ConfirmOptions | null>(null)
    const resolver = useRef<((result: boolean) => void) | null>(null)

    const confirm = useCallback<ConfirmFn>((opts) => {
        return new Promise((resolve) => {
            resolver.current = resolve
            setState(typeof opts === 'string' ? { message: opts } : opts)
        })
    }, [])

    const close = (result: boolean) => {
        resolver.current?.(result)
        resolver.current = null
        setState(null)
    }

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {state && createPortal(
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40" onClick={() => close(false)} />
                    <div className="relative card w-full max-w-sm p-6 space-y-4 animate-[fadeIn_.15s_ease]">
                        <div className="flex items-start gap-3">
                            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                                state.danger ? 'bg-red-100 dark:bg-red-500/15' : 'bg-amber-100 dark:bg-amber-500/15')}>
                                <AlertTriangle className={cn('w-5 h-5', state.danger ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')} strokeWidth={2} />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{state.title || 'Please confirm'}</h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{state.message}</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => close(false)}>{state.cancelLabel || 'Cancel'}</Button>
                            <Button variant={state.danger ? 'danger' : 'primary'} size="sm" onClick={() => close(true)}>{state.confirmLabel || 'Confirm'}</Button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </ConfirmContext.Provider>
    )
}
