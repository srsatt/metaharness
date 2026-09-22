---
name: metaharness
description: Configure, render, validate, or extend a metaharness Pkl profile, including model presets, roles, policies, and explicit skill sources.
---

Use this skill for metaharness profile changes.

Keep semantic configuration in `Profile`, `Policy`, `Role`, `ModelPreset`,
`Environment`, `SkillSource`, and `SkillExtension`. Put harness-specific syntax
only in a renderer. Never add machine paths, credentials, company integrations,
or hooks to public metaharness files.

Start with `mise run check`. Render targets with `mise run render:codex` or
`mise run render:opencode`. When changing models, update preset and keep roles
on preset names. Add native bindings each renderer requires; never substitute.

For skills, declare local directories and lock files in `Profile.skillSources`.
Use `Profile.exposedSkills` to select installations and `SkillExtension` for
consumer-local prepend or append text. Install a rendered profile with:

```sh
mise run skills:restore -- --manifest profile.json --base-dir . --replace
```

Use `--check` before installation when validating source paths. Read
[`README.md`](../../README.md) for profile examples and source rules.
