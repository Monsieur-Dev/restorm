/**
 * Postman dynamic variables (`{{$guid}}`, `{{$timestamp}}`, `{{$randomInt}}`,
 * the faker-style `{{$randomFirstName}}`, …) registered as zero-argument
 * Handlebars helpers, so an imported Postman collection's templates resolve the
 * same way they do in Postman — on BOTH the normal Send path and the scenario
 * `httpRequest` executor (both go through the shared Handlebars context).
 *
 * Postman resolves these per use, so they are intentionally non-deterministic
 * (random / time-based). We cover the common subset; an unknown `{{$random…}}`
 * stays unresolved (renders empty, as before) rather than throwing.
 */
import type Handlebars from 'handlebars'

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack']
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Martinez', 'Lopez']
const COLORS = ['red', 'green', 'blue', 'yellow', 'purple', 'cyan', 'magenta', 'black', 'white', 'orange']
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'tempor']
const COMPANIES = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark', 'Wayne', 'Wonka', 'Cyberdyne', 'Soylent']
const CITIES = ['Paris', 'London', 'Berlin', 'Madrid', 'Rome', 'Lisbon', 'Vienna', 'Prague', 'Oslo', 'Dublin']
const COUNTRIES = ['France', 'Germany', 'Spain', 'Italy', 'Portugal', 'Austria', 'Norway', 'Ireland', 'Sweden', 'Belgium']
const DOMAINS = ['example.com', 'test.dev', 'mail.io', 'sample.org', 'demo.net']

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)] ?? ''
const randInt = (max: number): number => Math.floor(Math.random() * max)

/** Each entry produces the string Postman would substitute for that variable. */
const DYNAMIC_VARS: Record<string, () => string> = {
  $guid: () => crypto.randomUUID(),
  $randomUUID: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(randInt(1001)),
  $randomBoolean: () => (Math.random() < 0.5 ? 'true' : 'false'),
  $randomFirstName: () => pick(FIRST_NAMES),
  $randomLastName: () => pick(LAST_NAMES),
  $randomFullName: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  $randomUserName: () => `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}${randInt(100)}`,
  $randomEmail: () => `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}@${pick(DOMAINS)}`,
  $randomColor: () => pick(COLORS),
  $randomWord: () => pick(WORDS),
  $randomWords: () => Array.from({ length: 3 }, () => pick(WORDS)).join(' '),
  $randomCompanyName: () => pick(COMPANIES),
  $randomCity: () => pick(CITIES),
  $randomCountry: () => pick(COUNTRIES),
  $randomPhoneNumber: () => `+1${randInt(900) + 100}${String(randInt(10000000)).padStart(7, '0')}`,
  $randomIP: () => `${randInt(256)}.${randInt(256)}.${randInt(256)}.${randInt(256)}`,
  $randomIPV4: () => `${randInt(256)}.${randInt(256)}.${randInt(256)}.${randInt(256)}`,
  $randomPrice: () => (randInt(100000) / 100).toFixed(2)
}

export function registerPostmanDynamicHelpers(hbs: typeof Handlebars): void {
  for (const [name, fn] of Object.entries(DYNAMIC_VARS)) {
    hbs.registerHelper(name, () => fn())
  }
}

/** The dynamic-variable names this module resolves (for tests / docs). */
export const POSTMAN_DYNAMIC_VARS = Object.keys(DYNAMIC_VARS)
