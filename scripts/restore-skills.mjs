#!/usr/bin/env node
import {cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
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
  process.exit(message ? 1 : 0);
}

function parseArguments(args) {
  const options = {locks: [], locals: [], replace: false, check: false, installRoot: null};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--lock") options.locks.push(resolve(args[++index] ?? usage("--lock needs a path")));
    else if (argument === "--local") options.locals.push(resolve(args[++index] ?? usage("--local needs a path")));
    else if (argument === "--install-root") options.installRoot = resolve(args[++index] ?? usage("--install-root needs a path"));
    else if (argument === "--replace") options.replace = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--help" || argument === "-h") usage();
    else usage(`unknown argument ${argument}`);
  }
  if (!options.installRoot) usage("--install-root is required");
  if (options.locks.length + options.locals.length === 0) usage("provide at least one --lock or --local source");
  return options;
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

function install(skills, options) {
  mkdirSync(options.installRoot, {recursive: true});
  for (const [name, source] of skills) {
    const target = join(options.installRoot, name);
    if (existsSync(target)) {
      if (!options.replace) throw new Error(`target exists: ${target}; rerun with --replace`);
      rmSync(target, {recursive: true, force: true});
    }
    cpSync(source, target, {recursive: true});
  }
}

const options = parseArguments(process.argv.slice(2));
const sources = collect(options);
if (options.check) {
  console.log(`valid: ${Object.keys(sources.locked).length} locked, ${sources.local.size} local skills`);
  process.exit(0);
}
const stagingRoot = mkdtempSync(join(tmpdir(), "metaharness-skills-"));
try {
  const installed = restoreLocked(sources.locked, stagingRoot);
  const skills = new Map([...sources.local, ...installed]);
  install(skills, options);
  console.log(`installed: ${skills.size} skills in ${options.installRoot}`);
} finally {
  rmSync(stagingRoot, {recursive: true, force: true});
}
