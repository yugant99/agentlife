// Command classification for Mythic City (plan 002, Lane A).
//
// Runs only inside the server process. Raw command text, prompts, messages,
// tool input and tool output NEVER leave the server; only CityAgent fields do.
//
// Rules (first tokens of the command):
//   git commit|push, gh pr  -> ship
//   npm test, node --test, pytest, vitest, jest, go test, cargo test -> test
//   anything else -> shell

/** Classify a shell command string into a ToolKind subset. Never throws. */
export function classifyCommand(command) {
  if (typeof command !== 'string') return 'shell'
  const text = command.trim()
  if (!text) return 'shell'
  const lower = text.toLowerCase()
  const tokens = lower.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 'shell'

  // Strip leading wrappers so `sudo git commit` and `npx vitest` still classify.
  let effective = tokens.slice()
  while (effective.length > 1 && (effective[0] === 'sudo' || effective[0] === 'env')) {
    effective = effective.slice(1)
  }

  // Ship: git commit|push (allow flags between git and the subcommand), gh pr.
  if (effective[0] === 'git') {
    const sub = effective.slice(1).find((token) => !token.startsWith('-'))
    if (sub === 'commit' || sub === 'push') return 'ship'
  }
  if (effective[0] === 'gh' && effective[1] === 'pr') return 'ship'

  // Test runners. Unwrap one npx/bunx/yarn/pnpm layer for direct runner calls.
  let testTokens = effective
  if ((testTokens[0] === 'npx' || testTokens[0] === 'bunx' || testTokens[0] === 'yarn' || testTokens[0] === 'pnpm') && testTokens.length > 1) {
    testTokens = testTokens.slice(1)
  }
  if (testTokens[0] === 'npm' && testTokens[1] === 'test') return 'test'
  if (testTokens[0] === 'node' && testTokens.includes('--test')) return 'test'
  if (testTokens[0] === 'pytest' || testTokens[0] === 'vitest' || testTokens[0] === 'jest') return 'test'
  if (testTokens[0] === 'go' && testTokens[1] === 'test') return 'test'
  if (testTokens[0] === 'cargo' && testTokens[1] === 'test') return 'test'

  return 'shell'
}

const EDIT_TOOLS = new Set(['edit', 'write', 'notebookedit'])
const SEARCH_TOOLS = new Set(['grep', 'glob'])

/**
 * Map a Claude/OpenCode tool name to a ToolKind. `command` is used only for
 * Bash-like tools and never leaves the server.
 */
export function toolKindForToolName(toolName, command) {
  if (typeof toolName !== 'string' || !toolName.trim()) return 'other'
  const name = toolName.trim()
  const lower = name.toLowerCase()

  if (lower === 'bash') return classifyCommand(command ?? '')
  if (EDIT_TOOLS.has(lower)) return 'edit'
  if (lower === 'read') return 'read'
  if (SEARCH_TOOLS.has(lower)) return 'search'
  if (lower === 'webfetch' || lower === 'websearch') return 'web'
  if (lower === 'agent' || lower === 'task') return 'delegate'
  if (lower === 'askuserquestion') return 'ask'
  // Browser MCP tools (any provider prefix) count as web lookups.
  if (lower.includes('browser') || lower.includes('webfetch') || lower.includes('websearch')) return 'web'
  return 'other'
}

/** Map a Codex item type to a ToolKind, or undefined when it carries no tool. */
export function toolKindForCodexItem(itemType, command, toolHint) {
  if (typeof itemType !== 'string') return undefined
  const lower = itemType.toLowerCase()
  if (lower === 'commandexecution') return classifyCommand(command ?? '')
  if (lower === 'filechange') return 'edit'
  if (lower === 'mcptoolcall') {
    const hint = `${toolHint ?? ''}`.toLowerCase()
    if (hint.includes('browser') || hint.includes('web') || hint.includes('fetch') || hint.includes('search')) return 'web'
    return 'other'
  }
  if (lower === 'function_call' || lower === 'functioncall') return 'other'
  // Reasoning / messages describe a phase (thinking/talking), not a tool spot.
  return undefined
}
