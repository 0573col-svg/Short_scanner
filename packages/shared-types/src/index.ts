// Re-export runtime constants explícitamente para que los bundlers (Rollup/Vite)
// puedan trazarlos vía análisis estático. `export *` con CommonJS compila a
// `__exportStar()`, que copia propiedades en runtime y no es analizable.
export { SCAN_NAMESPACE } from './socket-events';

// Tipos (sin emisión runtime): wildcards está OK
export * from './health';
export * from './scoring';
export * from './tracking';
export * from './trades';
export * from './users';
export * from './socket-events';
