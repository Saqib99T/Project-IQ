import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compose Tailwind class names with conflict resolution.
 * Later classes win on conflicting utilities (e.g. `px-2` then `px-4` → `px-4`).
 */
export function cn(...inputs) {
    return twMerge(clsx(inputs))
}
