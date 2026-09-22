import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "metaharness-test-"));
const run = (...args) => spawnSync(process.execPath, ["scripts/restore-skills.mjs", ...args], {encoding: "utf8"});
const runWithHome = (home, ...args) => spawnSync(process.execPath, ["scripts/restore-skills.mjs", ...args], {encoding: "utf8", env: {...process.env, HOME: home}});
const write = (path, text) => writeFileSync(path, text);
const lock = (skills) => JSON.stringify({version: 1, skills});
const specification = (source) => ({source, sourceType: "github", skillPath: "SKILL.md", computedHash: "hash"});

try {
  const local = join(root, "local");
  mkdirSync(join(local, "manual"), {recursive: true});
  write(join(local, "manual", "SKILL.md"), "---\nname: manual\ndescription: test\n---\n\n# Manual\n\nOriginal body.\n");
  const first = join(root, "first.json");
  const duplicate = join(root, "duplicate.json");
  const conflict = join(root, "conflict.json");
  const malformed = join(root, "malformed.json");
  const localConflict = join(root, "local-conflict.json");
  write(first, lock({locked: specification("owner/one")}));
  write(duplicate, lock({locked: specification("owner/one")}));
  write(conflict, lock({locked: specification("owner/two")}));
  write(malformed, "{");
  write(localConflict, lock({manual: specification("owner/manual")}));
  const base = ["--local", local, "--lock", first, "--lock", duplicate, "--install-root", join(root, "out"), "--check"];
  if (run(...base).status !== 0) throw new Error("valid sources rejected");
  const installed = join(root, "installed");
  if (run("--local", local, "--install-root", installed).status !== 0 || !existsSync(join(installed, "manual", "SKILL.md"))) throw new Error("local skill not installed");
  if (run("--local", local, "--install-root", installed).status === 0) throw new Error("existing target accepted without --replace");
  if (run("--local", local, "--install-root", installed, "--replace").status !== 0) throw new Error("--replace rejected");
  if (run("--lock", first, "--lock", conflict, "--install-root", join(root, "out"), "--check").status === 0) throw new Error("conflicting locks accepted");
  if (run("--lock", malformed, "--install-root", join(root, "out"), "--check").status === 0) throw new Error("malformed lock accepted");
  if (run("--local", local, "--lock", localConflict, "--install-root", join(root, "out"), "--check").status === 0) throw new Error("local collision accepted");

  const home = join(root, "home");
  const personalRoot = join(home, ".codex-personal", "skills");
  const creator = join(personalRoot, ".system", "skill-creator", "SKILL.md");
  mkdirSync(join(local, "unselected"), {recursive: true});
  mkdirSync(join(personalRoot, ".system", "skill-creator"), {recursive: true});
  write(join(local, "unselected", "SKILL.md"), "---\nname: unselected\ndescription: test\n---\n");
  write(creator, "---\nname: skill-creator\ndescription: test\n---\n\n# Creator\n");
  const manifest = join(root, "manifest.json");
  write(manifest, JSON.stringify({
    version: 1,
    skillSources: [{localUri: "local", lockUri: null, installRoot: "~/.codex-personal/skills"}],
    exposedSkills: ["manual"],
    skillExtensions: [
      {skillPath: "~/.codex-personal/skills/manual/SKILL.md", prepend: "PREPENDED", append: "APPENDED"},
      {skillPath: "~/.codex-personal/skills/.system/skill-creator/SKILL.md", prepend: "", append: "SYSTEM PATCH"},
    ],
  }));
  const manifestArgs = ["--manifest", manifest, "--base-dir", root];
  if (runWithHome(home, ...manifestArgs, "--check").status !== 0) throw new Error("valid manifest rejected");
  if (runWithHome(home, ...manifestArgs).status !== 0) throw new Error("manifest install failed");
  const installedText = readFileSync(join(personalRoot, "manual", "SKILL.md"), "utf8");
  if (!(installedText.indexOf("---", 4) < installedText.indexOf("PREPENDED") && installedText.indexOf("PREPENDED") < installedText.indexOf("# Manual") && installedText.indexOf("# Manual") < installedText.indexOf("APPENDED"))) throw new Error("prepend or append order is wrong");
  if (readFileSync(join(local, "manual", "SKILL.md"), "utf8").includes("PREPENDED")) throw new Error("source skill was modified");
  if (existsSync(join(personalRoot, "unselected"))) throw new Error("unexposed skill was installed");
  if (!readFileSync(creator, "utf8").includes("SYSTEM PATCH")) throw new Error("existing system skill was not extended");
  if (runWithHome(home, ...manifestArgs, "--replace").status !== 0) throw new Error("manifest reapply failed");
  if (readFileSync(join(personalRoot, "manual", "SKILL.md"), "utf8").split("PREPENDED").length !== 2) throw new Error("source extension accumulated");
  if (readFileSync(creator, "utf8").split("SYSTEM PATCH").length !== 2) throw new Error("system extension accumulated");

  const missing = join(root, "missing.json");
  write(missing, JSON.stringify({version: 1, skillSources: [{localUri: "local", installRoot: personalRoot}], exposedSkills: ["missing"], skillExtensions: []}));
  if (runWithHome(home, "--manifest", missing, "--base-dir", root, "--check").status === 0) throw new Error("missing exposed skill accepted");
  console.log("restore-skills tests passed");
} finally {
  rmSync(root, {recursive: true, force: true});
}
