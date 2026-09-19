import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {encoding: "utf8"});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
}

const temp = mkdtempSync(join(tmpdir(), "metaharness-check-"));
try {
  const contracts = join(temp, "contracts.json");
  run(process.platform === "win32" ? "pkl.exe" : "pkl", ["eval", "tests/contracts.pkl", "-o", contracts]);
  if (!Object.values(JSON.parse(readFileSync(contracts, "utf8"))).every(Boolean)) process.exit(1);
  for (const renderer of ["renderers/codex.pkl", "renderers/opencode.pkl", "renderers/claude.pkl", "renderers/gemini.pkl"]) {
    run(process.platform === "win32" ? "pkl.exe" : "pkl", ["eval", renderer]);
  }
  run(process.execPath, ["scripts/test-restore-skills.mjs"]);
} finally {
  rmSync(temp, {recursive: true, force: true});
}
