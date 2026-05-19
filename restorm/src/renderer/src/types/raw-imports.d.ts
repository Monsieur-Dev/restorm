// Type declarations for raw file imports (Vite ?raw suffix)

// Side-effect CSS imports — Vite resolves them at bundle time. TS6
// stopped tolerating these without a declaration (TS2882).
declare module '*.css'

declare module '*.graphql?raw' {
  const content: string
  export default content
}

declare module '*.proto?raw' {
  const content: string
  export default content
}

declare module '*.wsdl?raw' {
  const content: string
  export default content
}

declare module '*.yaml?raw' {
  const content: string
  export default content
}

declare module '*.yml?raw' {
  const content: string
  export default content
}

declare module '*.svg?raw' {
  const content: string
  export default content
}
