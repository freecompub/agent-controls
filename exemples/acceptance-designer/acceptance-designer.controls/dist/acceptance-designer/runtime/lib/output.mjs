// Sortie de décision au format de chaque client.
// decision : { type: 'allow' } | { type: 'deny' | 'block', reason }
export function render(client, event, decision) {
  if (!decision || decision.type === 'allow') {
    // Copilot peut remplacer la réponse du subagent renvoyée au parent : on y joint le signal d'escalade.
    if (decision?.response && client === 'copilot' && event === 'SubagentStop') return { modifiedResponse: decision.response };
    return null;
  }
  const reason = decision.reason;
  if (event === 'PreToolUse') {
    return client === 'claude'
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
      : { permissionDecision: 'deny', permissionDecisionReason: reason };
  }
  if (event === 'PostToolUse') {
    // Copilot ne peut pas bloquer en PostToolUse : information immédiate, contrôle rejoué au SubagentStop.
    return client === 'claude' ? { decision: 'block', reason } : { additionalContext: reason };
  }
  return { decision: 'block', reason };
}
