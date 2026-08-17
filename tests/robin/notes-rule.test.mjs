// The hook is pure bash with no dependencies, so its checks are bash too. This wrapper exists
// only so CI's tests/*/*.test.mjs glob picks them up; execFileSync throws on a non-zero exit,
// which is the failure signal node needs.
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Forward slashes: on the Windows runner this path is handed to Git Bash, which reads C:/x/y
// but not C:\x\y.
const script = join(dirname(fileURLToPath(import.meta.url)), 'test-notes-rule').replace(/\\/g, '/')
execFileSync('bash', [script], { stdio: 'inherit' })
