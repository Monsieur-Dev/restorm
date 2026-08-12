/**
 * Worker-scoped git-server container for the git e2e suites — the same
 * recipe as the compose `git-server` service (`git daemon` over a
 * bind-mounted bare-repos directory), but with a PER-WORKER mkdtemp repos
 * dir and an ephemeral published port. Seeding still happens HOST-side
 * (the host's git CLI writing into the bind mount), exactly like before —
 * only now every worker owns its directory, which retires the whole
 * "one checkout's repos dir is served host-wide" class.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GenericContainer, Wait } from 'testcontainers'
import { configureGitServerForTests, seedGitServer } from '../../../integration/gitServerSeed'

export interface StartedGitServer {
  port: number
  reposDir: string
  stop: () => Promise<void>
}

export async function startGitServer(): Promise<StartedGitServer> {
  const reposDir = mkdtempSync(join(tmpdir(), 'restorm-git-server-'))

  const container = await new GenericContainer('alpine:3.19')
    // `safe.directory *`: the bind-mounted bares are created by the HOST
    // user; the container's root git refuses to serve them otherwise
    // ("dubious ownership"). A throwaway localhost mock, so the blanket
    // exception is fine. The apk retry-loop mirrors the compose recipe.
    .withCommand(['sh', '-c',
      "until apk add --no-cache git-daemon; do sleep 2; done && git config --global --add safe.directory '*' && exec git daemon --base-path=/srv/git --export-all --enable=receive-pack --reuseaddr --informative-errors --verbose"
    ])
    .withBindMounts([{ source: reposDir, target: '/srv/git' }])
    .withExposedPorts(9418)
    // The apk install is the actual startup cost; the daemon binds right
    // after. Listening-port is the same probe the compose healthcheck used.
    .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(120_000))
    .start()

  const port = container.getMappedPort(9418)

  // Route every seed-module helper (URLs + repos dir) at THIS worker's
  // server, then lay down the shared read-only seed repo the same way
  // global-setup used to.
  configureGitServerForTests(port, reposDir)
  seedGitServer(reposDir)

  return {
    port,
    reposDir,
    stop: async () => {
      // Pushes from the app make the daemon (root in-container) write
      // objects into the bind mount; loosen them from inside so the host
      // user can delete the dir. Best-effort — a leftover tmpdir is
      // preferable to a red teardown.
      try {
        await container.exec(['chmod', '-R', 'a+rwX', '/srv/git'])
      } catch {
        // container already gone — fall through to the best-effort rm
      }
      await container.stop()
      try {
        rmSync(reposDir, { recursive: true, force: true })
      } catch {
        // root-owned leftovers; the OS tmp reaper owns them now
      }
    }
  }
}

/** The worker-fixture tuple the git suite fixtures spread in. */
export function gitServerWorkerFixture(): [
  ({}: object, use: (server: StartedGitServer) => Promise<void>) => Promise<void>,
  { scope: 'worker'; timeout: number }
] {
  return [
    async ({}: object, use: (server: StartedGitServer) => Promise<void>): Promise<void> => {
      const server = await startGitServer()
      try {
        await use(server)
      } finally {
        await server.stop()
      }
    },
    { scope: 'worker', timeout: 180_000 }
  ]
}
