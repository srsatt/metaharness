---
name: metaharness
description: Configure, render, validate, or extend a metaharness Pkl profile, including model presets, roles, policies, and explicit skill sources.
---

Use this skill for metaharness profile changes.

Keep semantic configuration in `Profile`, `Policy`, `Role`, `ModelPreset`,
`Environment`, and `SkillSource`. Put harness-specific syntax only in a
renderer. Never add machine paths, credentials, company integrations, hooks,
or Workmux configuration to public metaharness files.

Start with `mise run check`. Render targets with `mise run render:codex` or
`mise run render:opencode`. When changing models, update preset and keep roles
on preset names. Add native bindings each renderer requires; never substitute.

For skills, declare local directories and lock files in `Profile.skillSources`.
Install selected sources with:

```sh
mise run skills:restore -- --local skills --lock skills-lock.json --install-root .agents/skills
```

Use `--check` before installation when validating source paths. Read
[`README.md`](../../README.md) for profile examples and source rules.
