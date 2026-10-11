// City scope (plan 002, Lane A).
//
// An agent belongs to the city only when its cwd is exactly one of:
//   COMMAND_CENTER_SCOPE_CWD plus every worktree path that
//   `git -C <scope> worktree list --porcelain` reports (read-only git).
// Only folder basenames ever leave the server; full paths stay inside.

import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const WORKTREE_CACHE_TTL_MS = 60_000
let worktreeCache = { scope: null, paths: [], expiresAt: 0 }

/** Normalize a path for exact scope comparison. Never forwarded. */
export function normalizePath(value) {
  if (typeof value !== 'string' || !value) return ''
  return path.normalize(value)
}

/** Parse `git worktree list --porcelain` output into worktree paths. Pure. */
export function parseWorktreePorcelain(text) {
  if (typeof text !== 'string' || !text) return []
  const paths = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('worktree ')) continue
    const candidate = line.slice('worktree '.length).trim()
    if (candidate) paths.push(candidate)
  }
  return paths
}

/** Configured scope, or null when unset. */
export function getScope() {
  const scope = process.env.COMMAND_CENTER_SCOPE_CWD
  if (typeof scope !== 'string' || !scope.trim()) return null
  return scope.trim()
}

/** Exact-membership test against a normalized scope set. Pure. */
export function cwdInScopeSet(cwd, scopeSet) {
  if (typeof cwd !== 'string' || !cwd || !scopeSet || scopeSet.size === 0) return false
  return scopeSet.has(normalizePath(cwd))
}

/**
 * Short workspace label for a cwd. Never a full path. Worktrees usually keep the repo's
 * folder name (`<worktree-name>/<repo>`), so when the basename matches the scope's
 * basename but the cwd is not the scope itself, the worktree's own folder name is used.
 */
export function workspaceFor(cwd, fallback = 'unknown', scopeCwd = process.env.COMMAND_CENTER_SCOPE_CWD) {
  if (typeof cwd !== 'string' || !cwd.trim()) return fallback
  const normalized = normalizePath(cwd)
  const base = path.basename(normalized)
  if (!base) return fallback
  if (typeof scopeCwd === 'string' && scopeCwd.trim()) {
    const scope = normalizePath(scopeCwd)
    if (normalized !== scope && base === path.basename(scope)) {
      return path.basename(path.dirname(normalized)) || base
    }
  }
  return base
}

/** Short display name, at most 40 chars. Never prompt text. */
export function shortName(value, fallback) {
  const fallbackName = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : 'Agent'
  if (typeof value !== 'string' || !value.trim()) return fallbackName.slice(0, 40)
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || fallbackName.slice(0, 40)
}

async function readWorktrees(scope) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', scope, 'worktree', 'list', '--porcelain'], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
      env: process.env,
    })
    return parseWorktreePorcelain(stdout)
  } catch {
    // Read-only best effort: an unusable git repo still yields the scope itself.
    return []
  }
}

/** Scope plus worktree paths, normalized and deduped. Cached for 60 s. */
export async function getScopePaths() {
  const scope = getScope()
  if (!scope) return []
  const now = Date.now()
  if (worktreeCache.scope === scope && worktreeCache.expiresAt > now) return worktreeCache.paths
  const worktrees = await readWorktrees(scope)
  const paths = [...new Set([scope, ...worktrees])]
  worktreeCache = { scope, paths, expiresAt: now + WORKTREE_CACHE_TTL_MS }
  return paths
}

/** Normalized exact-match set for scope filtering. Empty when unconfigured. */
export async function getScopeSet() {
  const paths = await getScopePaths()
  return new Set(paths.map(normalizePath).filter(Boolean))
}
