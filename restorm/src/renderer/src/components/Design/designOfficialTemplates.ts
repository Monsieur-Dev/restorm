/**
 * Renderer mirror of the main-side OFFICIAL_TEMPLATES registry
 * (src/main/services/designCodegen/templateSource.ts). Ids travel over IPC; this
 * display list is kept in sync by hand (the main registry stays the source of
 * truth for acquisition + the MCP contract tool). Per-template descriptions are
 * i18n (`design.code.library.officialDesc.<id>`), not carried here.
 */
export interface OfficialChoice {
  id: string
  /** `owner/repo` on github — shown as the row's primary line. */
  repo: string
  /** Display language/stack label. */
  stack: string
}

export const OFFICIAL_CHOICES: readonly OfficialChoice[] = [
  {
    id: 'server-rest-typescript',
    repo: 'Monsieur-Dev/restorm-template-server-rest-typescript',
    stack: 'REST · TypeScript · Express'
  },
  {
    id: 'server-rest-dotnet',
    repo: 'Monsieur-Dev/restorm-template-server-rest-dotnet',
    stack: 'REST · C# · ASP.NET Core'
  },
  {
    id: 'server-grpc-typescript',
    repo: 'Monsieur-Dev/restorm-template-server-grpc-typescript',
    stack: 'gRPC · TypeScript'
  },
  {
    id: 'server-grpc-dotnet',
    repo: 'Monsieur-Dev/restorm-template-server-grpc-dotnet',
    stack: 'gRPC · C# / .NET'
  },
  {
    id: 'db-postgres',
    repo: 'Monsieur-Dev/restorm-template-db-postgres',
    stack: 'SQL · PostgreSQL'
  }
]

/** The friendly label for an official id (falls back to the raw id). */
export function officialLabel(id: string): string {
  return OFFICIAL_CHOICES.find((choice) => choice.id === id)?.stack ?? id
}

/** The `owner/repo` on github for an official id (undefined if unknown). */
export function officialRepo(id: string): string | undefined {
  return OFFICIAL_CHOICES.find((choice) => choice.id === id)?.repo
}
