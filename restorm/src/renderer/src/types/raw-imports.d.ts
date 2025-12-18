// Type declarations for raw file imports (Vite ?raw suffix)

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
