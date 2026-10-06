// Build metadata injected by Vite `define` (see vite.config.ts).

declare const __BUILD_HASH__: string | undefined

/** Short git hash of the build; 'unknown' when git was unavailable at build time or the define is missing. */
export const BUILD_HASH: string = typeof __BUILD_HASH__ === 'string' && __BUILD_HASH__ !== '' ? __BUILD_HASH__ : 'unknown'
