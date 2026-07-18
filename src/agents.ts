// The coding-agent CLIs scode wraps out of the box. "Installed" means the real command resolves (skipping our
// own shim dir, via resolveReal), so a CLI that scode already wraps still counts as installed. Cursor ships
// two identical entrypoints (`cursor-agent` and `agent`, both symlinks to one program), so its host covers
// both commands while detecting on the unambiguous `cursor-agent`.

import { resolveReal } from "./shim";

export type AgentKey = "claude" | "codex" | "cursor";

export type Agent = {
  key: AgentKey;
  label: string;
  detect: string; // the command that proves this CLI is present
  commands: string[]; // the command name(s) the wrapper shims
};

export const AGENTS: Agent[] = [
  { key: "claude", label: "Claude Code", detect: "claude", commands: ["claude"] },
  { key: "codex", label: "Codex", detect: "codex", commands: ["codex"] },
  { key: "cursor", label: "Cursor", detect: "cursor-agent", commands: ["cursor-agent", "agent"] },
];

/** True when the real command resolves (resolveReal returns its path, not the bare name). */
export function binInstalled(name: string): boolean {
  return resolveReal(name) !== name;
}

/** Whether a given agent's CLI is present on this machine. */
export function agentInstalled(key: AgentKey): boolean {
  const a = AGENTS.find((x) => x.key === key);
  return !!a && binInstalled(a.detect);
}

/** The agents whose CLI is actually installed here — so we never offer to wire up something absent. */
export function installedAgents(): Agent[] {
  return AGENTS.filter((a) => binInstalled(a.detect));
}
