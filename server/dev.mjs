import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: process.env }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'web'], { stdio: 'inherit', env: process.env }),
]

const stop = () => children.forEach((child) => child.kill('SIGTERM'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of children) child.on('exit', (code) => { if (code && code !== 0) { stop(); process.exitCode = code } })
