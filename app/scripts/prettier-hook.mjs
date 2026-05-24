/**
 * PostToolUse hook — auto-formats .ts/.tsx files with Prettier after every Edit or Write.
 * Receives the Claude Code tool event as JSON on stdin.
 */

import { execSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')

let input = ''
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const json = JSON.parse(input)
    const filePath = (json.tool_input?.file_path ?? '').replace(/\\/g, '/')
    if (!filePath || !/\.(tsx?)$/.test(filePath)) return
    execSync(`npx prettier --write "${filePath}"`, { cwd: appDir, stdio: 'pipe' })
  } catch {
    // Non-fatal — never block Claude on a formatter error
  }
})
