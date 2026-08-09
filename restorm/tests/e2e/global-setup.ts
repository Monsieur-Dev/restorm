import { execSync } from 'child_process'
import { rmSync } from 'fs'
import { resolve } from 'path'
import { isDockerAvailable } from '../integration/docker-setup'
import { FIREWALL_E2E_BYPASS_ENV } from '../../src/main/config/firewallE2EBypass'

/**
 * Per-test workspace dir wiped at the start of every run so a previous
 * failed/aborted run doesn't poison the next one. Resolved relative to
 * the restorm package root (cwd when Playwright runs). `.features-gen`
 * is owned by `bddgen` (which runs before Playwright in `npm run
 * test:e2e`); wiping it here would delete the freshly-generated specs
 * before Playwright discovers them.
 */
const TMP_DIR = resolve(process.cwd(), 'tests/e2e/.tmp')

function wipeTmpDir(): void {
  rmSync(TMP_DIR, { recursive: true, force: true })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function isDockerDaemonRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function tryStartDockerDaemon(): void {
  const commands = [
    'systemctl start docker',
    'service docker start'
  ]

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'ignore', timeout: 30000 })
      return
    } catch {
      // try next command
    }
  }
}

export default async function globalSetup(): Promise<void> {
  wipeTmpDir()

  // Arm the firewall's blanket bypass for the whole run. Every fixture
  // spreads `process.env` into its `electron.launch` env, so setting it
  // once here reaches all of them — and a fixture that wants the firewall
  // genuinely armed can override this single key in its own env block
  // (spread later, so it wins) without touching any other launch.
  //
  // Set here rather than inferred from the userData redirect: neutralising
  // a security control should be something a reader can see named, and
  // something one launch can decline without giving up its isolated profile.
  process.env[FIREWALL_E2E_BYPASS_ENV] = '1'

  // Every suite that needs a mock starts its OWN Testcontainers instance
  // (see tests/e2e/helpers/testcontainers/) — the shared compose stack is
  // no longer started, waited on, nor seeded here. Only the daemon itself
  // must be up.
  if (!isDockerAvailable()) {
    throw new Error([
      'Docker is not available for restorm E2E tests.',
      'Expected `docker` to be installed and accessible from PATH.'
    ].join('\n'))
  }

  if (!isDockerDaemonRunning()) {
    tryStartDockerDaemon()
    const start = Date.now()
    while (!isDockerDaemonRunning() && Date.now() - start < 15000) {
      await sleep(500)
    }
    if (!isDockerDaemonRunning()) {
      throw new Error([
        'Docker daemon is not running for restorm E2E tests.',
        'Tried to start it using `systemctl start docker` and `service docker start`.',
        'If you are running locally, start Docker Desktop / the docker service, then retry.',
        'If you are running in CI, ensure the runner provides a running Docker daemon.'
      ].join('\n'))
    }
  }

}
