declare module 'luxon' {
  export interface DateTime {
    toFormat(format: string): string
    toUTC(): DateTime
    toISO(): string | null
  }

  export const DateTime: {
    fromJSDate(date: Date): DateTime
  }
}
