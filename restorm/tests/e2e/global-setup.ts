import { execSync } from 'child_process'
import { isDockerAvailable, areContainersRunning, startDocker } from '../integration/docker-setup'

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
  if (!isDockerAvailable()) {
    throw new Error([
      'Docker is not available for restorm E2E tests.',
      'Expected `docker` and `docker compose` to be installed and accessible from PATH.'
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

  if (!areContainersRunning()) {
    try {
      startDocker()
    } catch (error) {
      throw new Error([
        'Docker compose services are not running for restorm E2E tests.',
        'Tried to run `docker compose up -d`.',
        `Error: ${String(error)}`
      ].join('\n'))
    }
    if (!areContainersRunning()) {
      throw new Error([
        'Docker compose services are not running for restorm E2E tests.',
        'Tried to run `docker compose up -d` but containers are still not reported as running.',
        'Check your Docker daemon status and the compose file at tests/docker/docker-compose.yml.'
      ].join('\n'))
    }
  }
}
