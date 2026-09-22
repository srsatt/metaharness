#!/usr/bin/env node
import {createHash} from "node:crypto";
import {cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, isAbsolute, join, resolve} from "node:path";
import {spawnSync} from "node:child_process";

const skillName = /^[a-z0-9][a-z0-9-]*$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function usage(message) {
  if (message) console.error(`restore-skills: ${message}`);
  console.error("usage: restore-skills.mjs --install-root DIR [--local DIR]... [--lock FILE]... [--replace] [--check]");
  console.error("       restore-skills.mjs --manifest FILE [--base-dir DIR] [--replace] [--check]");
  process.exit(message ? 1 : 0);
}

function parseArguments(args) {
  const options = {locks: [], locals: [], replace: false, check: false, installRoot: null, manifest: null, baseDir: process.cwd()};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--lock") options.locks.push(resolve(args[++index] ?? usage("--lock needs a path")));
    else if (argument === "--local") options.locals.push(resolve(args[++index] ?? usage("--local needs a path")));
    else if (argument === "--install-root") options.installRoot = resolve(args[++index] ?? usage("--install-root needs a path"));
    else if (argument === "--manifest") options.manifest = resolve(args[++index] ?? usage("--manifest needs a path"));
    else if (argument === "--base-dir") options.baseDir = resolve(args[++index] ?? usage("--base-dir needs a path"));
    else if (argument === "--replace") options.replace = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") usage();
    else usage(`unknown argument ${argument}`);
  }
  if (options.manifest) {
    if (options.installRoot || options.locks.length + options.locals.length > 0) usage("--manifest cannot be combined with --install-root, --local, or --lock");
    return options;
  }
  if (!options.installRoot) usage("--install-root is required");
  if (options.locks.length + options.locals.length === 0) usage("provide at least one --lock or --local source");
  return options;
}

function resolvePath(value, baseDir) {
  const home = process.env.HOME || homedir();
  const expanded = value === "~" ? home : value.startsWith("~/") ? join(home, value.slice(2)) : value;
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function readLock(path) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`invalid lock ${path}: ${error.message}`);
  }
  if (lock.version !== 1 || !lock.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills)) {
    throw new Error(`invalid lock ${path}: expected version 1 and skills object`);
  }
  for (const [name, specification] of Object.entries(lock.skills)) {
    if (!skillName.test(name) || !specification || typeof specification !== "object" || Array.isArray(specification)) {
      throw new Error(`invalid lock ${path}: invalid skill ${name}`);
    }
  }
  return lock.skills;
}

function localSkills(path) {
  if (!existsSync(path)) throw new Error(`local skill source does not exist: ${path}`);
  const skills = new Map();
  for (const entry of readdirSync(path, {withFileTypes: true})) {
    if (!entry.isDirectory() || !skillName.test(entry.name)) continue;
    const directory = join(path, entry.name);
    if (existsSync(join(directory, "SKILL.md"))) skills.set(entry.name, directory);
  }
  return skills;
}

function readManifest(path, baseDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`invalid manifest ${path}: ${error.message}`);
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.skillSources) || !Array.isArray(manifest.exposedSkills) || !Array.isArray(manifest.skillExtensions)) {
    throw new Error(`invalid manifest ${path}: expected version 1, skillSources, exposedSkills, and skillExtensions`);
  }

  const selected = new Set();
  for (const name of manifest.exposedSkills) {
    if (!skillName.test(name) || selected.has(name)) throw new Error(`invalid manifest ${path}: invalid or duplicate exposed skill ${name}`);
    selected.add(name);
  }

  const candidates = new Map();
  function addCandidate(name, candidate) {
    if (!selected.has(name)) return;
    if (candidates.has(name)) throw new Error(`skill ${name} appears in multiple manifest sources`);
    candidates.set(name, candidate);
  }

  for (const source of manifest.skillSources) {
    if (!source || typeof source !== "object" || Array.isArray(source) || typeof source.installRoot !== "string") {
      throw new Error(`invalid manifest ${path}: invalid skill source`);
    }
    const hasLock = typeof source.lockUri === "string" && source.lockUri.length > 0;
    const hasLocal = typeof source.localUri === "string" && source.localUri.length > 0;
    if (hasLock === hasLocal) throw new Error(`invalid manifest ${path}: skill source needs exactly one lockUri or localUri`);
    const installRoot = resolvePath(source.installRoot, baseDir);
    if (hasLock) {
      const lockPath = resolvePath(source.lockUri, baseDir);
      for (const [name, specification] of Object.entries(readLock(lockPath))) {
        addCandidate(name, {kind: "locked", specification, installRoot});
      }
    } else {
      const localPath = resolvePath(source.localUri, baseDir);
      for (const [name, directory] of localSkills(localPath)) {
        addCandidate(name, {kind: "local", directory, installRoot});
      }
    }
  }
  for (const name of selected) if (!candidates.has(name)) throw new Error(`exposed skill not found in manifest sources: ${name}`);

  const extensionPaths = new Set();
  for (const extension of manifest.skillExtensions) {
    if (!extension || typeof extension !== "object" || Array.isArray(extension) || typeof extension.skillPath !== "string" ||
      typeof extension.prepend !== "string" || typeof extension.append !== "string" ||
      (!extension.prepend.trim() && !extension.append.trim())) {
      throw new Error(`invalid manifest ${path}: invalid skill extension`);
    }
    if (extensionPaths.has(extension.skillPath)) throw new Error(`duplicate skill extension path: ${extension.skillPath}`);
    extensionPaths.add(extension.skillPath);
  }
  return {candidates, extensions: manifest.skillExtensions, baseDir};
}

function collect(options) {
  const locked = {};
  for (const path of options.locks) {
    for (const [name, specification] of Object.entries(readLock(path))) {
      if (locked[name] && JSON.stringify(canonical(locked[name])) !== JSON.stringify(canonical(specification))) throw new Error(`conflicting lock entry for ${name}`);
      locked[name] = specification;
    }
  }
  const local = new Map();
  for (const path of options.locals) {
    for (const [name, directory] of localSkills(path)) {
      if (local.has(name)) throw new Error(`duplicate local skill ${name}`);
      local.set(name, directory);
    }
  }
  for (const name of Object.keys(locked)) if (local.has(name)) throw new Error(`skill ${name} appears in both lock and local source`);
  return {locked, local};
}

function restoreLocked(locked, stagingRoot) {
  if (Object.keys(locked).length === 0) return new Map();
  const restoreRoot = join(stagingRoot, "locked");
  mkdirSync(restoreRoot);
  writeFileSync(join(restoreRoot, "skills-lock.json"), `${JSON.stringify({version: 1, skills: locked}, null, 2)}\n`);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, ["skills", "experimental_install", "--agent", "codex", "--yes"], {
    cwd: restoreRoot,
    stdio: "inherit",
    env: {...process.env, NPM_CONFIG_CACHE: join(stagingRoot, "npm-cache")},
  });
  if (result.status !== 0) throw new Error("skills CLI failed to restore lock");
  const installed = new Map();
  for (const name of Object.keys(locked)) {
    const directory = join(restoreRoot, ".agents", "skills", name);
    if (!existsSync(join(directory, "SKILL.md"))) throw new Error(`skills CLI did not restore ${name}`);
    installed.set(name, directory);
  }
  return installed;
}

function install(skills, replace) {
  for (const [name, {source, installRoot}] of skills) {
    mkdirSync(installRoot, {recursive: true});
    const target = join(installRoot, name);
    if (existsSync(target)) {
      if (!replace) throw new Error(`target exists: ${target}; rerun with --replace`);
      rmSync(target, {recursive: true, force: true});
    }
    cpSync(source, target, {recursive: true});
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function marker(identifier, placement, edge) {
  return `<!-- metaharness-extension:${identifier}:${placement}:${edge} -->`;
}

function removeManagedBlock(text, identifier, placement) {
  const start = marker(identifier, placement, "start");
  const end = marker(identifier, placement, "end");
  return text.replace(new RegExp(`(?:\\r?\\n)?${escapeRegExp(start)}\\r?\\n[\\s\\S]*?\\r?\\n${escapeRegExp(end)}(?:\\r?\\n)?`, "g"), "\n");
}

function managedBlock(identifier, placement, content) {
  return `${marker(identifier, placement, "start")}\n${content.trim()}\n${marker(identifier, placement, "end")}`;
}

function applyExtensions(extensions, baseDir) {
  for (const extension of extensions) {
    const path = resolvePath(extension.skillPath, baseDir);
    if (!existsSync(path)) throw new Error(`skill extension target does not exist: ${path}`);
    const identifier = createHash("sha256").update(extension.skillPath).digest("hex").slice(0, 16);
    let text = readFileSync(path, "utf8");
    text = removeManagedBlock(removeManagedBlock(text, identifier, "prepend"), identifier, "append");

    if (extension.prepend.trim()) {
      const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
      if (!frontmatter) throw new Error(`skill extension target lacks YAML frontmatter: ${path}`);
      const body = text.slice(frontmatter[0].length).replace(/^\r?\n*/, "");
      text = `${frontmatter[0]}\n${managedBlock(identifier, "prepend", extension.prepend)}\n\n${body}`;
    }
    if (extension.append.trim()) text = `${text.trimEnd()}\n\n${managedBlock(identifier, "append", extension.append)}\n`;
    writeFileSync(path, text);
  }
}

const options = parseArguments(process.argv.slice(2));
if (options.manifest) {
  const plan = readManifest(options.manifest, options.baseDir);
  if (options.check) {
    console.log(`valid: ${plan.candidates.size} exposed skills, ${plan.extensions.length} extensions`);
    process.exit(0);
  }
  const stagingRoot = mkdtempSync(join(tmpdir(), "metaharness-skills-"));
  try {
    const locked = Object.fromEntries([...plan.candidates].filter(([, candidate]) => candidate.kind === "locked").map(([name, candidate]) => [name, candidate.specification]));
    const restored = restoreLocked(locked, stagingRoot);
    const skills = new Map([...plan.candidates].map(([name, candidate]) => [name, {
      source: candidate.kind === "local" ? candidate.directory : restored.get(name),
      installRoot: candidate.installRoot,
    }]));
    install(skills, options.replace);
    applyExtensions(plan.extensions, plan.baseDir);
    console.log(`installed: ${skills.size} skills, ${plan.extensions.length} extensions`);
  } finally {
    rmSync(stagingRoot, {recursive: true, force: true});
  }
  process.exit(0);
}

const sources = collect(options);
if (options.check) {
  console.log(`valid: ${Object.keys(sources.locked).length} locked, ${sources.local.size} local skills`);
  process.exit(0);
}
const stagingRoot = mkdtempSync(join(tmpdir(), "metaharness-skills-"));
try {
  const installed = restoreLocked(sources.locked, stagingRoot);
  const skills = new Map([...sources.local, ...installed].map(([name, source]) => [name, {source, installRoot: options.installRoot}]));
  install(skills, options.replace);
  console.log(`installed: ${skills.size} skills in ${options.installRoot}`);
} finally {
  rmSync(stagingRoot, {recursive: true, force: true});
}
