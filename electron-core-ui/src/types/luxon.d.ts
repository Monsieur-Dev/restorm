declare module 'luxon' {
  export interface DateTime {
    readonly isValid: boolean
    toFormat(format: string): string
    toUTC(): DateTime
    toISO(): string | null
    toJSDate(): Date
  }

  export const DateTime: {
    fromJSDate(date: Date): DateTime
    fromSeconds(seconds: number): DateTime
    fromMillis(millis: number): DateTime
    fromISO(text: string): DateTime
    fromFormat(text: string, format: string): DateTime
  }
}
