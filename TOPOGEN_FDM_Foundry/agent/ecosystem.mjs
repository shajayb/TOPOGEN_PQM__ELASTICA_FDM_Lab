// One global ecosystem identity, propagated to every child process, manifest, and receipt.

export function resolveEcosystem(explicit, env = process.env) {
  const normalize = value => {
    if (value === undefined || value === null || value === '') return undefined;
    const key = String(value).trim().toLowerCase().replace(/_/g, '');
    if (!['antigravity', 'codex'].includes(key)) {
      throw Error('TOPOGEN_ECOSYSTEM / ALICE_ECOSYSTEM must be antigravity or codex');
    }
    return key;
  };
  const selected = normalize(explicit);
  const inheritedTopogen = normalize(env?.TOPOGEN_ECOSYSTEM);
  const inheritedAlice = normalize(env?.ALICE_ECOSYSTEM);
  return selected || inheritedTopogen || inheritedAlice || 'antigravity';
}

export function ecosystemInfo(ecosystem) {
  const value = resolveEcosystem(ecosystem, {});
  return {
    ecosystem: value,
    agentBackend: value === 'codex' ? 'Codex' : 'Gemini',
    desktop: value === 'codex' ? 'Codex Desktop' : 'Antigravity',
    uriScheme: value === 'codex' ? 'codex' : 'antigravity'
  };
}

export function ecosystemEnvironment(ecosystem, env = process.env) {
  const resolved = resolveEcosystem(ecosystem, env);
  return {
    ...env,
    TOPOGEN_ECOSYSTEM: resolved,
    ALICE_ECOSYSTEM: resolved
  };
}
