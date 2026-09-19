# metaharness

`metaharness` is portable Pkl source for coding-agent configuration. It keeps
agent intent separate from harness syntax: roles select named model presets,
policies route work, environments add local context, and renderers translate
that semantic profile for Codex, OpenCode, Claude Code, or Gemini CLI.

This boundary makes model changes safe. Change one preset and every role using
that preset follows it. Keep machine paths, credentials, MCP servers, hooks,
and editor or Workmux setup in your consumer repository.

## Start

Use this repository as a GitHub template, or copy it into an existing config
repository. [mise](https://mise.jdx.dev/) installs pinned Pkl and Node versions:

```sh
mise install
mise run check
mise run render:codex
mise run render:opencode
```

The render commands print structured JSON contracts. A consumer imports a
renderer, assigns its own `Profile`, then writes the rendered value in the
native file format it needs. See [examples/codex.pkl](examples/codex.pkl) and
[examples/opencode.pkl](examples/opencode.pkl).

## Customize precisely

Start from `defaults.pkl`. A profile contains only six public concepts:

| Concept | Purpose |
| --- | --- |
| `ModelPreset` | provider, model identifier, effort, native bindings |
| `Role` | preset name, read-only flag, instructions, capabilities |
| `Policy` | shared instructions, routing, approval and sandbox defaults |
| `Environment` | consumer-specific instructions and capabilities |
| `Profile` | one complete composition |
| `SkillSource` | a local skill directory or `skills-lock.json`, plus install root |

Copy this pattern into your config repository and replace only values you own:

```pkl
amends "../metaharness/renderers/codex.pkl"

import "../metaharness/defaults.pkl" as defaults
import "../metaharness/schema.pkl" as schema

profile = new schema.Profile {
  name = "my-codex"
  models = new Mapping {
    ["cheap"] = defaults.value.models["cheap"]
    ["medium"] = new schema.ModelPreset {
      provider = "openai"
      model = "my-model"
      effort = "high"
      codexModel = "my-model"
      codexEffort = "high"
      nativeModel = "my-model"
    }
    ["max"] = defaults.value.models["max"]
  }
  roles = defaults.value.roles
  policy = defaults.value.policy
  environment = new schema.Environment {
    name = "personal"
    instructions = "Use only this profile's configured integrations."
  }
  skillSources = new {
    new schema.SkillSource { localUri = "skills"; installRoot = ".agents/skills" }
    new schema.SkillSource { lockUri = "skills-lock.json"; installRoot = ".agents/skills" }
  }
}
```

Keep role preset names unchanged when only model allocation changes. Add roles
only when instructions and permissions differ materially. Renderers fail when
required native model binding is absent; they never substitute one.

## Benjamin-Plus policy

Defaults include concise Benjamin-Plus efficiency instructions. They direct
agents to batch reconnaissance, limit inspection output, avoid repeated polls,
and run stated checks. This keeps long agent sessions from spending tokens on
unnecessary context and tool calls.

It is public policy, not a discoverable skill. To change or remove it, override
`Policy.efficiencyInstructions` in consumer profile. Put personal workflow
rules in consumer environment or policy, never in this package.

## Skills

`SkillSource` records intent. `scripts/restore-skills.mjs` performs explicit
installation from hand-written local skills and reproducible locks:

```sh
mise run skills:restore -- \
  --local skills \
  --lock skills-lock.json \
  --install-root .agents/skills
```

PowerShell uses same arguments on one line:

```powershell
mise run skills:restore -- --local skills --lock skills-lock.json --install-root .agents/skills
```

Each local source contains one directory per skill, with `SKILL.md` inside.
Each lock uses `{ "version": 1, "skills": { ... } }`, emitted by `skills` CLI.
Repeated identical lock entries deduplicate. Conflicting entries and duplicate
local/locked names fail before files change. Locked skills restore in a temp
directory through `npx skills experimental_install --agent codex --yes`, then
copy into install root. Existing target skill directories require `--replace`.

Lock and local paths resolve from consumer repository where command runs. Pkl
`lockUri` and `localUri` likewise resolve relative to consumer configuration. A
lock entry never grants profile access: set `Profile.exposedSkills` for a
restricted profile.

## Commands

| Command | Result |
| --- | --- |
| `mise install` | install pinned Pkl and Node |
| `mise run check` | Pkl contracts and offline installer tests |
| `mise run render:codex` | render default Codex contract |
| `mise run render:opencode` | render default OpenCode contract |
| `mise run render:claude` | render default Claude Code contract |
| `mise run render:gemini` | render default Gemini CLI contract |
| `mise run skills:restore -- …` | install selected local and locked skills |

This repository has no updater, runtime service, machine paths, credentials,
company integrations, or Workmux configuration. Pkl, Mise, and Node scripts
support Windows, macOS, and Linux. License: [MIT](LICENSE).
