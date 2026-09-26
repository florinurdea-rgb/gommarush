// Stub for the `server-only` package.
//
// The real module throws on import outside a React Server Component, which
// is exactly the guard we want in the app and exactly what stops a Node test
// runner from importing any server module. Aliased in vitest.config.ts.
export {};
