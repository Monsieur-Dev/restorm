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

// Suites open their fixtures from a working copy INSIDE this checkout, so the
// app under test sees the repository the suite itself lives in. Left alone,
// its git integration fetches and — whenever the checkout differs from its
// remote, which is the normal state of anyone mid-work — raises a "pull
// available" toast over the running app. That toast is clickable, so it eats
// the clicks aimed at whatever it covers, and tests fail by a few pixels,
// differently from run to run. The suites that are ABOUT this behaviour clear
// the variable when they launch (see the git-conflict fixture).
const child = spawn(cmd, args, {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, ECUI_DISABLE_GIT_REMOTE_CHECK: '1' }
})
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
