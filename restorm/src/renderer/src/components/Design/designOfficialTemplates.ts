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
    id: 'server-typescript',
    repo: 'Monsieur-Dev/restorm-template-server-typescript',
    stack: 'TypeScript · Express'
  },
  {
    id: 'server-dotnet',
    repo: 'Monsieur-Dev/restorm-template-server-dotnet',
    stack: 'C# · ASP.NET Core'
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
