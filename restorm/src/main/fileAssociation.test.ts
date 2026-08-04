import { describe, it, expect } from 'vitest'
import { PROJECT_FILE_EXTENSION, isProjectFilePath, findProjectFileInArgv } from './fileAssociation'

describe('PROJECT_FILE_EXTENSION', () => {
  it('is the dotted lowercase extension registered with the OS', () => {
    expect(PROJECT_FILE_EXTENSION).toBe('.restorm')
  })
})

describe('isProjectFilePath', () => {
  it('recognises an absolute POSIX path', () => {
    expect(isProjectFilePath('/home/user/projects/api.restorm')).toBe(true)
  })

  it('recognises an absolute Windows path', () => {
    expect(isProjectFilePath('C:\\Users\\user\\Documents\\api.restorm')).toBe(true)
  })

  it('recognises a relative path', () => {
    expect(isProjectFilePath('./api.restorm')).toBe(true)
    expect(isProjectFilePath('api.restorm')).toBe(true)
  })

  it('recognises a path with spaces', () => {
    expect(isProjectFilePath('/home/user/My API Project.restorm')).toBe(true)
  })

  it('is case-insensitive on the extension', () => {
    expect(isProjectFilePath('/tmp/API.RESTORM')).toBe(true)
    expect(isProjectFilePath('/tmp/api.Restorm')).toBe(true)
  })

  it('rejects any other extension', () => {
    expect(isProjectFilePath('/tmp/project.json')).toBe(false)
    expect(isProjectFilePath('/tmp/project.yaml')).toBe(false)
    expect(isProjectFilePath('/tmp/project.restorm.bak')).toBe(false)
  })

  it('rejects a flag, even one that ends in the extension', () => {
    // An option VALUE must never be mistaken for a document to open.
    expect(isProjectFilePath('--open')).toBe(false)
    expect(isProjectFilePath('-o')).toBe(false)
    expect(isProjectFilePath('--open=/tmp/api.restorm')).toBe(false)
    expect(isProjectFilePath('--ozone-platform-hint=auto')).toBe(false)
  })

  it('rejects a bare extension with no basename', () => {
    expect(isProjectFilePath('.restorm')).toBe(false)
    expect(isProjectFilePath('/home/user/.restorm')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isProjectFilePath('')).toBe(false)
  })

  it('rejects a deep-link URL', () => {
    // `restorm://` URLs travel the same two channels but are handled by
    // `deepLink.ts`; neither module may claim the other's input.
    expect(isProjectFilePath('restorm://auth/callback?code=abc')).toBe(false)
  })

  it('does not require the file to exist', () => {
    expect(isProjectFilePath('/nonexistent/path/to/nowhere.restorm')).toBe(true)
  })
})

describe('findProjectFileInArgv', () => {
  it('finds a path passed as a bare positional (the OS file-association shape)', () => {
    const argv = ['/opt/restorm/restorm-bin', '/home/user/api.restorm']
    expect(findProjectFileInArgv(argv)).toBe('/home/user/api.restorm')
  })

  it('finds the path among Chromium switches', () => {
    const argv = [
      '/opt/restorm/restorm-bin',
      '--no-sandbox',
      '--ozone-platform-hint=auto',
      '/home/user/api.restorm',
      '--enable-unsafe-swiftshader'
    ]
    expect(findProjectFileInArgv(argv)).toBe('/home/user/api.restorm')
  })

  it('returns undefined when no project path is present', () => {
    expect(findProjectFileInArgv(['/opt/restorm/restorm-bin', '--no-sandbox'])).toBeUndefined()
    expect(findProjectFileInArgv(['/opt/restorm/restorm-bin'])).toBeUndefined()
    expect(findProjectFileInArgv([])).toBeUndefined()
  })

  it('ignores the executable itself', () => {
    // A binary is never a document, even in the pathological case where
    // someone named it after the extension.
    expect(findProjectFileInArgv(['/opt/weird/launcher.restorm'])).toBeUndefined()
  })

  it('returns the first path when several are passed', () => {
    // An OS-launched handler passes exactly one document; honouring more
    // than one would mean picking which gets the window.
    const argv = ['/opt/restorm/restorm-bin', '/home/a.restorm', '/home/b.restorm']
    expect(findProjectFileInArgv(argv)).toBe('/home/a.restorm')
  })

  it('resolves the same path as --open when both spellings point at one file', () => {
    // `--open <path>` is the CLI's own channel, parsed by `parseCliArgs`,
    // and its value sits in argv as a separate token this function also
    // matches. That overlap is harmless — both channels name the same
    // document — and it is the reason the caller must not open twice.
    const argv = ['/opt/restorm/restorm-bin', '--open', '/home/user/api.restorm']
    expect(findProjectFileInArgv(argv)).toBe('/home/user/api.restorm')
  })

  it('ignores a deep-link URL in argv', () => {
    const argv = ['/opt/restorm/restorm-bin', '--', 'restorm://auth/callback?code=abc']
    expect(findProjectFileInArgv(argv)).toBeUndefined()
  })
})
