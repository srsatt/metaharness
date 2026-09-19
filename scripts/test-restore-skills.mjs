import {existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "metaharness-test-"));
const run = (...args) => spawnSync(process.execPath, ["scripts/restore-skills.mjs", ...args], {encoding: "utf8"});
const write = (path, text) => writeFileSync(path, text);
const lock = (skills) => JSON.stringify({version: 1, skills});
const specification = (source) => ({source, sourceType: "github", skillPath: "SKILL.md", computedHash: "hash"});

try {
  const local = join(root, "local");
  mkdirSync(join(local, "manual"), {recursive: true});
  write(join(local, "manual", "SKILL.md"), "---\nname: manual\ndescription: test\n---\n");
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
  console.log("restore-skills tests passed");
} finally {
  rmSync(root, {recursive: true, force: true});
}
