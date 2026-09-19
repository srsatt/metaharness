import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "metaharness-renderers-"));
const pkl = process.platform === "win32" ? "pkl.exe" : "pkl";
const roles = {
  primary: {tier: "cheap", readOnly: false},
  implementer: {tier: "medium", readOnly: false},
  verifier: {tier: "cheap", readOnly: true},
  architect: {tier: "max", readOnly: true},
  reviewer: {tier: "max", readOnly: true},
  researcher: {tier: "cheap", readOnly: true},
};
const codexModels = {
  cheap: ["gpt-5.6-terra", "medium"],
  medium: ["gpt-5.6-sol", "high"],
  max: ["gpt-6-astra", "high"],
};
const opencodeModels = {
  cheap: "bifrost/deepseek-ai/DeepSeek-V4-Flash-0731",
  medium: "bifrost/MiniMaxAI/MiniMax-M2.7",
  max: "bifrost/moonshotai/Kimi-K2.6",
};

function fail(message) {
  throw new Error(`renderer contract: ${message}`);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function render(module) {
  const output = join(root, `${module.replaceAll(/[/.]/g, "-")}.json`);
  const result = spawnSync(pkl, ["eval", module, "-o", output], {encoding: "utf8"});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(readFileSync(output, "utf8"));
}

function assertInstructions(value, label) {
  if (typeof value !== "string" || !value.includes("BENJAMIN-PLUS MODE ACTIVE")) fail(`${label}: missing Benjamin-Plus policy`);
  if (value.includes("## UI copy") || value.includes("Workmux is an optional")) fail(`${label}: leaked local prompt policy`);
}

function assertRoleNames(agents) {
  equal(JSON.stringify(Object.keys(agents).sort()), JSON.stringify(Object.keys(roles).sort()), "agent roles");
}

try {
  const codex = render("renderers/codex.pkl");
  equal(codex.config.model, codexModels.cheap[0], "Codex primary model");
  equal(codex.config.model_reasoning_effort, codexModels.cheap[1], "Codex primary effort");
  equal(codex.config.agents.default_subagent_model, codexModels.medium[0], "Codex default subagent model");
  equal(codex.config.agents.default_subagent_reasoning_effort, codexModels.medium[1], "Codex default subagent effort");
  equal(codex.config.approval_policy, "on-request", "Codex approval policy");
  equal(codex.config.sandbox_mode, "workspace-write", "Codex sandbox mode");
  assertInstructions(codex.config.developer_instructions, "Codex primary instructions");
  assertRoleNames(codex.agents);
  for (const [name, role] of Object.entries(roles)) {
    const agent = codex.agents[name];
    equal(agent.model, codexModels[role.tier][0], `Codex ${name} model`);
    equal(agent.model_reasoning_effort, codexModels[role.tier][1], `Codex ${name} effort`);
    equal(agent.sandbox_mode, role.readOnly ? "read-only" : "workspace-write", `Codex ${name} sandbox`);
    equal(agent.approval_policy, "never", `Codex ${name} approval policy`);
    if (typeof agent.description !== "string" || agent.description.length === 0) fail(`Codex ${name}: missing description`);
    assertInstructions(agent.developer_instructions, `Codex ${name} instructions`);
  }

  const opencode = render("renderers/opencode.pkl");
  equal(opencode.$schema, "https://opencode.ai/config.json", "OpenCode schema");
  equal(opencode.model, opencodeModels.cheap, "OpenCode primary model");
  assertRoleNames(opencode.agents);
  for (const [name, role] of Object.entries(roles)) {
    equal(opencode.agents[name].model, opencodeModels[role.tier], `OpenCode ${name} model`);
    equal(opencode.agents[name].readonly, role.readOnly, `OpenCode ${name} read-only`);
    assertInstructions(opencode.agents[name].instructions, `OpenCode ${name} instructions`);
  }

  for (const [name, renderer, permission] of [
    ["Claude", "renderers/claude.pkl", ["permissions", "defaultMode"]],
    ["Gemini", "renderers/gemini.pkl", ["tools", "approvalMode"]],
  ]) {
    const output = render(renderer);
    equal(output.settings.model, codexModels.cheap[0], `${name} primary model`);
    equal(output.settings[permission[0]][permission[1]], "ask", `${name} approval mode`);
    assertInstructions(output.settings.instructions, `${name} primary instructions`);
    assertRoleNames(output.agents);
    for (const [roleName, role] of Object.entries(roles)) {
      equal(output.agents[roleName].model, codexModels[role.tier][0], `${name} ${roleName} model`);
      equal(output.agents[roleName].readOnly, role.readOnly, `${name} ${roleName} read-only`);
      assertInstructions(output.agents[roleName].instructions, `${name} ${roleName} instructions`);
    }
  }

  const customized = render("examples/customize.pkl");
  equal(customized.config.model, codexModels.cheap[0], "customized primary model");
  equal(customized.config.agents.default_subagent_model, "my-model", "customized default subagent model");
  equal(customized.agents.implementer.model, "my-model", "customized implementer model");
  equal(customized.agents.implementer.model_reasoning_effort, "high", "customized implementer effort");
  console.log("renderer contracts passed");
} finally {
  rmSync(root, {recursive: true, force: true});
}
