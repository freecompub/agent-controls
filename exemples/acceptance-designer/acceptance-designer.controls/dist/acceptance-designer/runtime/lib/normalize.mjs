// Traduit le payload d'un client (Claude Code ou Copilot) en événement normalisé.
import { rel } from './util.mjs';

const TOOLS = {
  // Noms Claude Code (aussi rapportés par Copilot avec les événements en PascalCase)
  Read: 'file.read', Glob: 'file.read', Grep: 'file.read', LS: 'file.read',
  Write: 'file.write', Edit: 'file.write', MultiEdit: 'file.write', NotebookEdit: 'file.write',
  Bash: 'shell.exec', WebFetch: 'web.fetch', WebSearch: 'web.fetch',
  Task: 'subagent.spawn', Agent: 'subagent.spawn',
  TaskOutput: 'file.read', BashOutput: 'file.read', // lecture de la sortie d'une commande en arrière-plan
  KillShell: 'shell.exec', KillBash: 'shell.exec',
  // Noms natifs Copilot (événements en camelCase ou outils sans équivalent)
  view: 'file.read', grep: 'file.read', rg: 'file.read', glob: 'file.read',
  create: 'file.write', edit: 'file.write', str_replace_editor: 'file.write', apply_patch: 'file.write',
  bash: 'shell.exec', powershell: 'shell.exec', web_fetch: 'web.fetch', web_search: 'web.fetch',
  task: 'subagent.spawn',
};

export function toolCategory(name) {
  if (!name) return null;
  if (name.startsWith('mcp__')) return 'mcp.call';
  return TOOLS[name] || 'unknown';
}

function pick(obj, keys) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function extractInput(ti) {
  if (typeof ti === 'string') {
    try { ti = JSON.parse(ti); } catch { return { paths: [], content: null, command: null }; }
  }
  ti = ti && typeof ti === 'object' ? ti : {};
  const paths = [];
  for (const k of ['file_path', 'path', 'filePath', 'target_file', 'notebook_path']) {
    if (typeof ti[k] === 'string') paths.push(ti[k]);
  }
  // Patchs (apply_patch) : chemins listés dans le texte du patch.
  const patch = [ti.patch, ti.input, ti.command].find((v) => typeof v === 'string' && /\*\*\* Begin Patch|^\+\+\+ /m.test(v));
  if (patch) {
    for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) paths.push(m[1].trim());
    for (const m of patch.matchAll(/^\+\+\+ b\/(.+)$/gm)) paths.push(m[1].trim());
  }
  let content = pick(ti, ['content', 'file_text', 'new_string', 'new_str']);
  if (content === undefined && Array.isArray(ti.edits)) content = ti.edits.map((e) => e?.new_string ?? '').join('\n');
  const command = pick(ti, ['command', 'cmd']);
  return {
    paths: [...new Set(paths)],
    content: typeof content === 'string' ? content : null,
    command: typeof command === 'string' && !patch ? command : null,
  };
}

export function normalize(client, event, p) {
  p = p && typeof p === 'object' ? p : {};
  const projectDir = process.env.CLAUDE_PROJECT_DIR || pick(p, ['cwd']) || process.cwd();
  const toolName = pick(p, ['tool_name', 'toolName']) || null;
  const toolInput = pick(p, ['tool_input', 'toolArgs']);
  const input = extractInput(toolInput);
  input.paths = input.paths.map((x) => rel(projectDir, x));
  const agentNames = ['agent_type', 'agent_name', 'agentType', 'agentName']
    .map((k) => p[k]).filter((v) => typeof v === 'string' && v);
  return {
    client, event, projectDir, toolName,
    tool: toolCategory(toolName),
    toolInput: toolInput && typeof toolInput === 'object' ? toolInput : {},
    input,
    sessionId: String(pick(p, ['session_id', 'sessionId']) || 'sans-session'),
    agentId: pick(p, ['agent_id', 'agentId']) || null,
    agentNames,
    stopHookActive: Boolean(pick(p, ['stop_hook_active', 'stopHookActive'])),
    finalMessage: pick(p, ['last_assistant_message', 'response']) ?? null,
    transcriptPath: pick(p, ['agent_transcript_path', 'transcript_path', 'transcriptPath']) ?? null,
  };
}

/** Un nom d'agent rapporté correspond-il à l'agent du plugin ? (accepte un préfixe d'espace de noms) */
export function isAgent(names, agent) {
  return names.some((n) => n === agent || n.endsWith(`:${agent}`) || n.endsWith(`/${agent}`));
}

/** Pour une délégation (outil subagent.spawn) : agent ciblé et consigne transmise. */
export function delegation(n) {
  const ti = n.toolInput || {};
  const target = pick(ti, ['subagent_type', 'agent_type', 'agent', 'agentName', 'agent_name', 'name']);
  const prompt = pick(ti, ['prompt', 'task', 'description']);
  return { target: typeof target === 'string' ? target : null, prompt: typeof prompt === 'string' ? prompt : null };
}
