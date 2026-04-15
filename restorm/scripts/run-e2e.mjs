#!/usr/bin/env node
/**
 * Cross-platform runner for `playwright test`:
 *   - On Linux with `xvfb-run` available, wraps playwright in xvfb at a large
 *     display size (1920x1080). This lets the window-state test (which uses
 *     screen coordinates like x=1310) pass in headless environments where the
 *     ambient display would otherwise be too small (e.g. devcontainer webtop).
 *   - Everywhere else, runs `playwright test` directly.
 */
import { spawn, spawnSync } from 'node:child_process'
import { platform } from 'node:os'

// Drop a leading `--` separator that pnpm/npm injects between the script
// invocation and the forwarded args so the arguments land correctly on
// `playwright test`.
const rawArgs = process.argv.slice(2)
const forwardedArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs

function hasXvfb() {
  if (platform() !== 'linux') return false
  const which = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' })
  return which.status === 0 || which.status === 2
}

const useXvfb = hasXvfb()
const cmd = useXvfb ? 'xvfb-run' : 'playwright'
const args = useXvfb
  ? ['-a', '-s', '-screen 0 1920x1080x24', 'playwright', 'test', ...forwardedArgs]
  : ['test', ...forwardedArgs]

const child = spawn(cmd, args, { stdio: 'inherit', shell: false })
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
