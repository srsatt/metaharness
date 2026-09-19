# metaharness

Portable Pkl configuration for coding-agent roles, routing, policies, and
Codex, OpenCode, Claude Code, and Gemini CLI renderers.

Pkl is pinned in `.mise.toml`. Renderers use Pkl's maintained JSON renderer;
consumers may convert that structured output to a native harness format.

`defaults.pkl` provides semantic roles. A consumer can amend a renderer and
replace `profile` with its own `Profile`; roles keep preset names, so changing a
preset changes every dependent role. Renderers fail through Pkl evaluation if a
required native model field is absent.

Run the public checks:

```sh
pkl eval tests/contracts.pkl
pkl eval examples/codex.pkl
pkl eval examples/opencode.pkl
```

Use this repository as a GitHub template, or copy its files into a standalone
configuration repository. It has no host paths, credentials, Workmux settings,
company integrations, or runtime updater requirement.
