#!/usr/bin/env -S node --no-warnings=ExperimentalWarning --experimental-strip-types

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

type GitRemoteInfo = Readonly<{
  owner: string;
  repo: string;
}>;

type PackageJson = Readonly<{
  name?: string | undefined;
  private?: boolean | undefined;
  description?: string | undefined;
  license?: string | undefined;
  author?: Readonly<{ name: string; email: string }> | undefined;
  homepage?: string | undefined;
  bugs?: Readonly<{ url: string }> | undefined;
  repository?: Readonly<{ type: string; url: string }> | undefined;
  funding?: ReadonlyArray<Readonly<Record<string, string>>> | undefined;
  files?: ReadonlyArray<string> | undefined;
  scripts: Record<string, string>;
  devDependencies?: Record<string, string> | undefined;
  [key: string]: unknown;
}>;

type JsrJson = Readonly<{
  name: string;
  [key: string]: unknown;
}>;

type TemplateContext = Readonly<{
  name: string;
  repoOwner: string;
  repoName: string;
}>;

type InitConfig = Readonly<{
  name: string;
  description: string;
  authorName: string;
  authorEmail: string;
  repoOwner: string;
  repoName: string;
  licenseType: string;
  includeTidelift?: boolean | undefined;
  includeTests?: boolean | undefined;
  includeJsr?: boolean | undefined;
  includeRenovate?: boolean | undefined;
  includeCommitizen?: boolean | undefined;
  includeVSCode?: boolean | undefined;
  isPrivate?: boolean | undefined;
}>;

type SchemaNode = Readonly<{
  type?: string | undefined;
  pattern?: string | undefined;
  enum?: ReadonlyArray<string> | undefined;
  minLength?: number | undefined;
  format?: string | undefined;
  required?: ReadonlyArray<string> | undefined;
  additionalProperties?: boolean | undefined;
  properties?: Readonly<Record<string, SchemaNode>> | undefined;
}>;

type MutationPath = Readonly<{
  relativePath: string;
  kind: "file" | "directory";
}>;

type Snapshot = Readonly<{
  tempDir: string;
  entries: ReadonlyArray<SnapshotEntry>;
}>;

type SnapshotEntry = Readonly<{
  relativePath: string;
  kind: "file" | "directory";
  existed: boolean;
  backupPath: string;
}>;

const TEST_DEV_DEP_PATTERNS = [/^vitest$/u, /^@vitest\//u, /^eslint-plugin-no-only-tests$/u];
const COMMITIZEN_DEV_DEP_PATTERNS = [/^@commitlint\//u, /^commitizen$/u, /^cz-/u];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Validates a value against a JSON-schema node, supporting the subset of keywords
 * used by scripts/init-config.schema.json (type, pattern, enum, minLength, format,
 * required, additionalProperties). Hand-rolled because ajv is unavailable at init
 * time in fresh template copies (node_modules absent).
 *
 * @param value - The value to validate.
 * @param schema - The schema node to validate against.
 * @param prefix - Prefix for error messages (used internally by recursion).
 * @returns Collected, human-readable error messages (empty when valid).
 */
function validateAgainstSchema(value: unknown, schema: SchemaNode, prefix = ""): string[] {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${prefix === "" ? "config" : prefix}: must be an object`];
    }
    const record = value as Record<string, unknown>;
    // Boolean flags are intentionally treated as optional even though the schema
    // lists them under `required`: --config mode applies documented defaults for
    // any omitted boolean instead of rejecting it.
    const requiredErrors = (schema.required ?? [])
      .filter((key) => record[key] === undefined && schema.properties?.[key]?.type !== "boolean")
      .map((key) => `${prefix}${key}: is required`);
    const allowedKeys = Object.keys(schema.properties ?? {});
    const additionalErrors =
      schema.additionalProperties === false
        ? Object.keys(record)
            .filter((key) => !allowedKeys.includes(key))
            .map((key) => `${prefix}${key}: is not an allowed property`)
        : [];
    const propertyErrors = Object.entries(schema.properties ?? {}).flatMap(([key, subSchema]) =>
      record[key] === undefined ? [] : validateAgainstSchema(record[key], subSchema, `${prefix}${key}: `),
    );
    return [...requiredErrors, ...additionalErrors, ...propertyErrors];
  }

  const label = prefix === "" ? "config" : prefix.replace(/: $/u, "");
  if (schema.enum !== undefined) {
    return typeof value === "string" && schema.enum.includes(value)
      ? []
      : [`${label}: must be one of: ${schema.enum.join(", ")}`];
  }
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        return [`${label}: must be a string`];
      }
      const lengthErrors =
        schema.minLength !== undefined && value.length < schema.minLength
          ? [`${label}: must be at least ${schema.minLength} character(s) long`]
          : [];
      const patternErrors =
        schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)
          ? [`${label}: must match pattern ${schema.pattern}`]
          : [];
      const emailErrors =
        schema.format === "email" && !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/u.test(value)
          ? [`${label}: must be a valid email address`]
          : [];
      return [...lengthErrors, ...patternErrors, ...emailErrors];
    }
    case "boolean": {
      return typeof value === "boolean" ? [] : [`${label}: must be a boolean`];
    }
    default: {
      return [];
    }
  }
}

/**
 * Parses JSON text, throwing a descriptive error on failure.
 *
 * @param text - Raw JSON text.
 * @param filePath - Path the text was read from (for error messages).
 * @returns The parsed value.
 * @throws {Error} When the text is not valid JSON.
 */
function parseJsonOrThrow(text: string, filePath: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`❌ Config file is not valid JSON: ${filePath}\n${String(error)}`);
  }
}

/**
 * Reads and parses scripts/init-config.schema.json.
 *
 * @returns The parsed schema node.
 * @throws {Error} When the schema file cannot be read or parsed.
 */
async function readInitConfigSchema(): Promise<SchemaNode> {
  try {
    const raw = await fs.readFile(path.resolve(import.meta.dirname, "init-config.schema.json"), "utf8");
    return JSON.parse(raw) as SchemaNode;
  } catch {
    throw new Error("❌ Unable to read scripts/init-config.schema.json");
  }
}

/**
 * Loads and validates the JSON config passed via --config.
 *
 * @param configPath - Path to the JSON config file.
 * @returns The validated partial init config.
 * @throws {Error} When the config is unreadable, invalid JSON, or fails schema validation.
 */
async function loadInitConfig(configPath: string): Promise<Partial<InitConfig>> {
  const raw = await fs.readFile(path.resolve(configPath), "utf8").catch(() => {
    throw new Error(`❌ Config file not readable: ${configPath}`);
  });
  const parsed = parseJsonOrThrow(raw, configPath);
  const schema = await readInitConfigSchema();
  const errors = validateAgainstSchema(parsed, schema);
  if (errors.length > 0) {
    const formatted = errors.map((error) => `  - ${error}`).join("\n");
    throw new Error(`❌ Invalid init config (${errors.length} error(s)):\n${formatted}`);
  }
  return parsed as Partial<InitConfig>;
}

/**
 * Normalizes a string by trimming, lowercasing, and collapsing whitespace.
 *
 * @param str - Input string.
 * @returns Normalized string.
 */
function normalize(str: string): string {
  return str.trim().toLowerCase().replaceAll(/\s+/gu, " ");
}

async function ignoreSyncPath(filePath: string): Promise<void> {
  const syncIgnorePath = path.resolve(".templatesyncignore");
  try {
    await fs.appendFile(syncIgnorePath, `${filePath}\n`, "utf8");
  } catch {
    // ignore
  }
}

/**
 * Checks whether a relative path is a given top-level entry or located inside it.
 *
 * Unlike a bare `startsWith` check, sibling entries sharing a prefix (e.g.
 * "dist-utils") are not matched.
 *
 * @param relative - Relative path to test.
 * @param dir - Top-level directory name.
 * @returns True when the path equals the directory or starts with the directory segment.
 */
function isInTopLevelDir(relative: string, dir: string): boolean {
  return relative === dir || relative.startsWith(`${dir}/`);
}

/**
 * Strips a delimited comment block from text.
 *
 * @param content - Input text.
 * @param blockName - Name of block tag (e.g. "template-tidelift").
 * @returns Text with block removed.
 */
function removeBlock(content: string, blockName: string): string {
  const regex = new RegExp(`<!--\\s*${blockName}-start\\s*-->.*?<!--\\s*${blockName}-end\\s*-->\\n?`, "gsu");
  return content.replaceAll(regex, "");
}

/**
 * Strips all remaining template comment tags from text and normalizes spacing.
 *
 * @param content - Input text.
 * @returns Clean text without template marker comments.
 */
function stripRemainingCommentMarkers(content: string): string {
  const stripped = content.replaceAll(/<!--\s*template-[a-z-]+-(?:start|end)\s*-->\n?/gu, "");
  return `${stripped.replaceAll(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

/**
 * Normalizes CRLF line endings to LF.
 *
 * Used by the document-update helpers so that files checked out with Windows
 * line endings are processed correctly; output is always written back with LF.
 *
 * @param content - Input text.
 * @returns Text with CRLF line endings converted to LF.
 */
function normalizeEol(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

/**
 * Escapes regular expression special characters within a string.
 *
 * @param str - Input string.
 * @returns String safe to embed as a literal in a RegExp pattern.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[$()*+.?[\\\]^{|}]/gu, "\\$&");
}

/**
 * Replaces standard template repository placeholders in a single pass.
 *
 * A combined alternation is used instead of chained replacements so that
 * replacement values which themselves contain placeholder-like text (e.g. a
 * package name containing "RebeccaStevens") are never re-processed.
 *
 * @param content - The source string.
 * @param context - Template naming and repository metadata.
 * @returns String with all template placeholders updated.
 */
function replacePlaceholders(content: string, context: TemplateContext): string {
  const jsrPkgName = context.name.startsWith("@") ? context.name : `@${context.repoOwner}/${context.name}`;

  // Ordered longest-first so that e.g. "RebeccaStevens/template-typescript-node-package"
  // is matched whole rather than being partially rewritten by the bare
  // "RebeccaStevens" alternative.
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ["# Template for my Node Packages", `# ${context.name}`],
    ["img.shields.io/jsr/v/package_name.svg", `img.shields.io/jsr/v/${jsrPkgName}.svg`],
    ["jsr.io/package_name", `jsr.io/${jsrPkgName}`],
    ["jsr:package_name", `jsr:${jsrPkgName}`],
    ["jsr add package_name", `jsr add ${jsrPkgName}`],
    ["RebeccaStevens/template-typescript-node-package", `${context.repoOwner}/${context.repoName}`],
    ["package_name", context.name],
    ["RebeccaStevens", context.repoOwner],
  ];

  const lookup = new Map(replacements);
  const pattern = new RegExp(replacements.map(([from]) => escapeRegExp(from)).join("|"), "gu");

  return content.replaceAll(pattern, (matched) => lookup.get(matched) ?? matched);
}

/**
 * Executes a git command and returns the trimmed output.
 *
 * @param key - The git config key to query.
 * @returns The trimmed string value or empty string.
 */
function getGitConfig(key: string): string {
  try {
    return execSync(`git config --get ${key}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/**
 * Extracts owner and repo name from git remote origin URL.
 *
 * Supports https and scp-like ssh syntaxes (with an optional port) and allows
 * dotted repository names; the ".git" suffix is optional.
 *
 * @returns Object containing owner and repo strings.
 */
function getGitRemoteInfo(): GitRemoteInfo {
  const url = getGitConfig("remote.origin.url");
  if (url === "") {
    return { owner: "", repo: "" };
  }
  const match = /github\.com(?::\d+)?[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/u.exec(url);
  if (match === null) {
    return { owner: "", repo: "" };
  }
  return { owner: match[1] ?? "", repo: match[2] ?? "" };
}

/**
 * Resolves the --config flag (space or inline "=" form) and the argument indices
 * it reserves from positional-argument detection.
 *
 * @param args - CLI arguments, excluding the executable and script paths.
 * @returns The config path (undefined when the flag is absent) and reserved indices.
 * @throws {Error} When the flag is present without a usable file path.
 */
function parseConfigArgs(args: ReadonlyArray<string>): Readonly<{
  configPath: string | undefined;
  reservedIndices: ReadonlyArray<number>;
}> {
  const configFlagIndex = args.findIndex(
    (arg) => arg === "--config" || arg === "-c" || arg.startsWith("--config=") || arg.startsWith("-c="),
  );
  if (configFlagIndex === -1) {
    return { configPath: undefined, reservedIndices: [] };
  }

  const flag = args[configFlagIndex] ?? "";
  const inlineValue = /^(?:--config|-c)=(.+)$/su.exec(flag)?.[1];
  const value = inlineValue ?? args[configFlagIndex + 1];
  if (value === undefined || value === "" || value.startsWith("-")) {
    throw new Error("❌ --config requires a file path argument.");
  }

  return {
    configPath: value,
    reservedIndices: inlineValue === undefined ? [configFlagIndex, configFlagIndex + 1] : [configFlagIndex],
  };
}

/**
 * Prompts the user for input with a default value.
 *
 * @param question - Question text to display.
 * @param defaultValue - Fallback default value.
 * @returns User response or default value.
 */
async function prompt(question: string, defaultValue: string): Promise<string> {
  const answer = await rl.question(`${question} [${defaultValue}]: `);
  const trimmed = answer.trim();
  return trimmed === "" ? defaultValue : trimmed;
}

/**
 * Prompts the user for a boolean (yes/no) response.
 *
 * @param question - Question text to display.
 * @param defaultYes - Fallback default choice (true for yes, false for no).
 * @returns User choice as boolean.
 */
async function promptBoolean(question: string, defaultYes: boolean): Promise<boolean> {
  const defaultHint = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`${question} [${defaultHint}]: `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") {
    return defaultYes;
  }
  return trimmed === "y" || trimmed === "yes";
}

const SUPPORTED_LICENSES: ReadonlyArray<string> = ["BSD-3-Clause", "MIT", "Apache-2.0", "UNLICENSED"];
// eslint-disable-next-line regexp/optimize-regex -- mirrors the pattern in scripts/init-config.schema.json
const REPO_IDENTIFIER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/u;
// eslint-disable-next-line regexp/optimize-regex -- mirrors the pattern in scripts/init-config.schema.json
const NPM_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/u;
const MAX_PROMPT_RETRIES = 3;

/**
 * Validates that a value is not empty after trimming.
 *
 * @param label - Human-readable field name for error messages.
 * @returns A validator returning an error message or null when valid.
 */
function validateNonEmpty(label: string): (value: string) => string | null {
  return (value) => (value.trim() === "" ? `${label} must not be empty` : null);
}

/**
 * Validates a GitHub username, organization, or repository name.
 *
 * @param label - Human-readable field name for error messages.
 * @returns A validator returning an error message or null when valid.
 */
function validateRepoIdentifier(label: string): (value: string) => string | null {
  return (value) =>
    REPO_IDENTIFIER_PATTERN.test(value)
      ? null
      : `${label} must contain only letters, numbers, dots, and hyphens (and not start or end with a dot or hyphen)`;
}

/**
 * Validates an npm package name against the npm naming rules.
 *
 * @param label - Human-readable field name for error messages.
 * @returns A validator returning an error message or null when valid.
 */
function validateNpmName(label: string): (value: string) => string | null {
  return (value) =>
    NPM_NAME_PATTERN.test(value)
      ? null
      : `${label} must be a valid npm package name (lowercase, optionally scoped with @scope/name)`;
}

/**
 * Validates an email address using a basic structural check.
 *
 * @param label - Human-readable field name for error messages.
 * @returns A validator returning an error message or null when valid.
 */
function validateEmail(label: string): (value: string) => string | null {
  return (value) => (EMAIL_PATTERN.test(value) ? null : `${label} must be a valid email address`);
}

/**
 * Validates a license identifier against the supported set.
 *
 * @param value - License identifier to validate.
 * @returns An error message or null when valid.
 */
function validateLicense(value: string): string | null {
  return SUPPORTED_LICENSES.includes(value) ? null : `must be one of: ${SUPPORTED_LICENSES.join(", ")}`;
}

/**
 * Prompts the user, re-prompting on invalid input up to a fixed retry limit,
 * then aborts. Mirrors the validation applied by --config mode for interactive
 * answers.
 *
 * @param question - Question text to display.
 * @param defaultValue - Fallback default value.
 * @param validate - Validator returning an error message or null when valid.
 * @returns The first answer passing validation.
 * @throws {Error} When the retry limit is exceeded.
 */
async function promptValidated(
  question: string,
  defaultValue: string,
  validate: (value: string) => string | null,
): Promise<string> {
  for (let mut_attempt = 0; mut_attempt <= MAX_PROMPT_RETRIES; mut_attempt++) {
    // eslint-disable-next-line no-await-in-loop -- prompts are inherently sequential
    const answer = await prompt(question, defaultValue);
    const error = validate(answer);
    if (error === null) {
      return answer;
    }
    console.error(`❌ ${error}`);
  }
  throw new Error("❌ Too many invalid answers; aborting before any changes were made.");
}

/**
 * Generates license text based on choice.
 *
 * @param licenseType - Chosen license name.
 * @param year - Copyright year.
 * @param authorName - Copyright author.
 * @returns License text or null if UNLICENSED.
 */
function getLicenseText(licenseType: string, year: number, authorName: string): string | null {
  const norm = licenseType.trim().toUpperCase();
  if (norm === "MIT") {
    return `MIT License\n\nCopyright (c) ${year} ${authorName}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
  }
  if (norm === "BSD-3-CLAUSE" || norm === "BSD") {
    return `BSD 3-Clause License\n\nCopyright (c) ${year}, ${authorName}\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
  }
  if (norm === "APACHE-2.0" || norm === "APACHE") {
    return `Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n\nCopyright ${year} ${authorName}\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n`;
  }
  return null;
}

/**
 * Returns license badge metadata for supported license types.
 *
 * @param licenseType - Chosen license name.
 * @returns Badge text and license URL, or null if UNLICENSED.
 */
function getLicenseBadgeInfo(licenseType: string): Readonly<{
  badgeText: string;
  licenseUrl: string;
}> | null {
  const norm = licenseType.trim().toUpperCase();
  if (norm === "MIT") {
    return {
      badgeText: "MIT license",
      licenseUrl: "https://opensource.org/licenses/MIT",
    };
  }
  if (norm === "BSD-3-CLAUSE" || norm === "BSD") {
    return {
      badgeText: "BSD 3 Clause license",
      licenseUrl: "https://opensource.org/licenses/BSD-3-Clause",
    };
  }
  if (norm === "APACHE-2.0" || norm === "APACHE") {
    return {
      badgeText: "Apache 2.0 license",
      licenseUrl: "https://opensource.org/licenses/Apache-2.0",
    };
  }
  return null;
}

/**
 * Uniquely determines if the user running initialization is Rebecca Stevens.
 *
 * @param info - Author name and email identity details.
 * @returns True if and only if both the author name and email match Rebecca Stevens.
 */
function isUserRebeccaStevens(
  info: Readonly<{
    authorName: string;
    authorEmail: string;
  }>,
): boolean {
  const rebeccaName = "rebecca stevens";
  const rebeccaEmail = "rebecca.stevens@outlook.co.nz";

  return normalize(info.authorName) === rebeccaName && normalize(info.authorEmail) === rebeccaEmail;
}

/**
 * Helper to update README.md by stripping template setup docs and updating placeholders.
 *
 * @param filePath - Path to README.md.
 * @param context - Template naming and repository metadata.
 * @param includeJsr - Whether JSR configuration is enabled.
 * @param isRebecca - Whether author is Rebecca Stevens.
 * @param includeTidelift - Whether Tidelift funding is included.
 * @param licenseType - The chosen license type.
 * @param includeTests - Whether test suite is included.
 * @param includeCommitizen - Whether Commitizen is included.
 */
async function updateReadme(
  filePath: string,
  context: TemplateContext,
  includeJsr: boolean,
  isRebecca: boolean,
  includeTidelift: boolean,
  licenseType: string,
  includeTests: boolean,
  includeCommitizen: boolean,
): Promise<void> {
  try {
    // CRLF input is normalized to LF before processing.
    const raw = normalizeEol(await fs.readFile(filePath, "utf8"));
    const withoutInit = removeBlock(raw, "template-init");
    const withoutSync = removeBlock(withoutInit, "template-sync");
    const withoutJsr = includeJsr
      ? withoutSync
      : removeBlock(removeBlock(withoutSync, "template-jsr-badge"), "template-jsr-install");
    const withoutDonationsOrTidelift = isRebecca
      ? includeTidelift
        ? withoutJsr
        : removeBlock(withoutJsr, "template-tidelift")
      : removeBlock(withoutJsr, "template-donations");
    const replaced = replacePlaceholders(withoutDonationsOrTidelift, context);

    // Update license badge
    const licenseInfo = getLicenseBadgeInfo(licenseType);
    const withLicenseBadge =
      licenseInfo === null
        ? // eslint-disable-next-line regexp/optimize-regex
          replaced.replaceAll(/\[!\[BSD 3 Clause license\].*?\]\(.*?\)\\?\n?/gu, "")
        : replaced
            .replaceAll("BSD 3 Clause license", licenseInfo.badgeText)
            .replaceAll("https://opensource.org/licenses/BSD-3-Clause", licenseInfo.licenseUrl);

    // Remove Codecov badge when tests are disabled
    const withoutCovBadge = includeTests
      ? withLicenseBadge
      : // eslint-disable-next-line regexp/optimize-regex
        withLicenseBadge.replaceAll(/\[!\[Coverage Status\].*?\]\(.*?\)\\?\n?/gu, "");

    // Remove Commitizen badge when Commitizen is disabled
    const withoutCzBadge = includeCommitizen
      ? withoutCovBadge
      : // eslint-disable-next-line regexp/optimize-regex
        withoutCovBadge.replaceAll(/\[!\[Commitizen friendly\].*?\]\(.*?\)\\?\n?/gu, "");

    const finalContent = stripRemainingCommentMarkers(withoutCzBadge);

    await fs.writeFile(filePath, finalContent, "utf8");
  } catch {
    // ignore if README.md doesn't exist
  }
}

/**
 * Helper to update DONATIONS.md by updating placeholders and conditionally removing Tidelift.
 *
 * @param filePath - Path to DONATIONS.md.
 * @param context - Template naming and repository metadata.
 * @param includeTidelift - Whether Tidelift funding is included.
 */
async function updateDonations(filePath: string, context: TemplateContext, includeTidelift: boolean): Promise<void> {
  try {
    // CRLF input is normalized to LF before processing.
    const raw = normalizeEol(await fs.readFile(filePath, "utf8"));
    const filtered = includeTidelift ? raw : removeBlock(raw, "template-tidelift");
    // Preserve the literal RebeccaStevens/RebeccaStevens path used in crypto asset URLs
    const assetPlaceholder = "%%ASSET_OWNER_PATH%%";
    const protectedText = filtered.replaceAll("RebeccaStevens/RebeccaStevens", assetPlaceholder);
    const replaced = replacePlaceholders(protectedText, context);
    const restored = replaced.replaceAll(assetPlaceholder, "RebeccaStevens/RebeccaStevens");
    const finalContent = stripRemainingCommentMarkers(restored);

    await fs.writeFile(filePath, finalContent, "utf8");
  } catch {
    // ignore if DONATIONS.md doesn't exist
  }
}

/**
 * Helper to update AGENTS.md by removing template-only sections.
 *
 * @param filePath - Path to AGENTS.md.
 */
async function updateAgentsMd(filePath: string): Promise<void> {
  try {
    // CRLF input is normalized to LF before processing.
    const raw = normalizeEol(await fs.readFile(filePath, "utf8"));
    const filtered = removeBlock(raw, "template-agents-template-only");
    const finalContent = stripRemainingCommentMarkers(filtered);

    await fs.writeFile(filePath, finalContent, "utf8");
  } catch {
    // ignore if AGENTS.md doesn't exist
  }
}

/**
 * Helper to update .github/FUNDING.yml by updating placeholders and conditionally removing Tidelift.
 *
 * @param filePath - Path to .github/FUNDING.yml.
 * @param context - Template naming and repository metadata.
 * @param includeTidelift - Whether Tidelift funding is included.
 */
async function updateFundingYml(filePath: string, context: TemplateContext, includeTidelift: boolean): Promise<void> {
  try {
    // CRLF input is normalized to LF before processing.
    const raw = normalizeEol(await fs.readFile(filePath, "utf8"));
    const filtered = includeTidelift ? raw : raw.replaceAll(/^\s*tidelift:\s*(?:\S.*)?\n/gmu, "");
    const finalContent = replacePlaceholders(filtered, context);

    await fs.writeFile(filePath, finalContent, "utf8");
  } catch {
    // ignore if FUNDING.yml doesn't exist
  }
}

/**
 * Lists every filesystem path (relative to the working directory) that a given
 * run may mutate, derived from the init flags plus the always-touched template
 * documents. Files are returned before directories so rollback restores
 * whole-directory entries last.
 *
 * @param options - The resolved init flags and identity/licensing state.
 * @returns Paths to snapshot, files first then directories.
 */
function getMutatedPaths(
  options: Readonly<{
    includeJsr: boolean;
    includeTests: boolean;
    includeCommitizen: boolean;
    includeVSCode: boolean;
    includeRenovate: boolean;
    isRebecca: boolean;
    includeTidelift: boolean;
  }>,
): ReadonlyArray<MutationPath> {
  const files = [
    "package.json",
    "README.md",
    "LICENSE",
    "DONATIONS.md",
    ".github/FUNDING.yml",
    "AGENTS.md",
    "CONTRIBUTING.md",
    ".templatesyncignore",
    "eslint.config.js",
    "CHANGELOG.md",
    "jsr.json",
    ".releaserc.yml",
    ...(options.isRebecca && options.includeTidelift ? [] : ["SECURITY.md"]),
    ...(options.includeTests
      ? []
      : [
          "vitest.config.ts",
          ".github/workflows/test-js.yml",
          ".github/workflows/release.yml",
          ".github/codecov.yml",
          ".vscode/launch.json",
        ]),
    ...(options.includeRenovate ? [] : [".github/renovate.json"]),
    ...(options.includeCommitizen ? [] : [".czrc", ".commitlintrc.cjs", ".husky/commit-msg"]),
  ];
  const directories = [
    ...(options.includeTests ? [] : ["tests"]),
    ...(options.includeVSCode ? [] : [".vscode"]),
    "scripts",
  ];
  return [
    ...files.map((relativePath) => ({ relativePath, kind: "file" as const })),
    ...directories.map((relativePath) => ({ relativePath, kind: "directory" as const })),
  ];
}

/**
 * Snapshots every path in {@link mutatedPaths} that currently exists by copying
 * it into a fresh temporary directory (byte-for-byte for files, recursive for
 * directories). Paths that do not exist are recorded so they can be removed
 * again on rollback if the run creates them.
 *
 * @param mutatedPaths - Paths the run may mutate.
 * @returns The snapshot handle used to restore or discard the backup.
 */
async function createSnapshot(mutatedPaths: ReadonlyArray<MutationPath>): Promise<Snapshot> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-snapshot-"));
  try {
    const entries = await Promise.all(
      mutatedPaths.map(async ({ relativePath, kind }) => {
        const absolutePath = path.resolve(relativePath);
        const backupPath = path.join(tempDir, relativePath);
        const existed = await fs
          .access(absolutePath)
          .then(() => true)
          .catch(() => false);
        if (existed) {
          await fs.mkdir(path.dirname(backupPath), { recursive: true });
          await fs.cp(absolutePath, backupPath, { recursive: kind === "directory" });
        }
        return { relativePath, kind, existed, backupPath };
      }),
    );
    return { tempDir, entries };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Restores a single snapshot entry: paths that existed before are reinstated
 * from the backup, and paths that did not exist are removed (deleting anything
 * the run created).
 *
 * @param entry - The snapshot entry to restore.
 */
async function restoreEntry(entry: SnapshotEntry): Promise<void> {
  const absolutePath = path.resolve(entry.relativePath);
  if (!entry.existed) {
    await fs.rm(absolutePath, { recursive: true, force: true });
    return;
  }
  await fs.rm(absolutePath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.cp(entry.backupPath, absolutePath, { recursive: entry.kind === "directory" });
}

/**
 * Restores the working directory to its pre-mutation state. Files are restored
 * first so whole-directory entries overwrite them last.
 *
 * @param snapshot - The snapshot to restore from.
 */
async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  await Promise.all(snapshot.entries.filter((entry) => entry.kind === "file").map(restoreEntry));
  await Promise.all(snapshot.entries.filter((entry) => entry.kind === "directory").map(restoreEntry));
}

/**
 * Restores the snapshot and captures any restoration failure so the caller can
 * preserve the backup when rollback itself fails.
 *
 * @param snapshot - The snapshot to restore from.
 * @returns The restoration error, or undefined when restore succeeded.
 */
async function tryRestoreSnapshot(snapshot: Snapshot): Promise<unknown> {
  try {
    await restoreSnapshot(snapshot);
    return undefined;
  } catch (error) {
    return error;
  }
}

/**
 * Deletes the temporary snapshot directory after a successful run or rollback.
 *
 * @param snapshot - The snapshot to discard.
 */
async function discardSnapshot(snapshot: Snapshot): Promise<void> {
  try {
    await fs.rm(snapshot.tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; a stale temp dir is harmless.
  }
}

try {
  console.log("\n🚀 Initializing package from template...\n");

  const isAdvanced = process.argv.includes("--advanced") || process.argv.includes("-a");

  // Parse CLI arguments: --config <path>, --config=<path>, -c <path>, or -c=<path>,
  // plus an optional positional target directory.
  const args = process.argv.slice(2);
  const { configPath, reservedIndices } = parseConfigArgs(args);

  // Load and validate the config before touching the filesystem so invalid configs
  // fail fast without side effects.
  const initConfig = configPath === undefined ? null : await loadInitConfig(configPath);

  // Handle npx positional target directory argument (e.g. npx ... my-new-package)
  const targetArg = args.find((arg, index) => !reservedIndices.includes(index) && !arg.startsWith("-"));

  const targetPath =
    targetArg !== undefined && targetArg.trim() !== "" ? path.resolve(targetArg.trim()) : process.cwd();
  const sourcePath = path.resolve(import.meta.dirname, "..");

  if (targetPath !== sourcePath) {
    if (targetArg !== undefined && targetArg.trim() !== "") {
      console.log(`📁 Target directory specified: ${targetArg.trim()}\n`);
      await fs.mkdir(targetPath, { recursive: true });
    }

    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      filter: (src) => {
        const relative = path.relative(sourcePath, src);
        return (
          !isInTopLevelDir(relative, "node_modules") &&
          !isInTopLevelDir(relative, "dist") &&
          !relative.startsWith("coverage") &&
          !relative.startsWith(".wireit/") &&
          !relative.startsWith(".git/") &&
          relative !== ".git" &&
          relative !== ".wireit"
        );
      },
    });

    process.chdir(targetPath);

    try {
      execSync("git init", { stdio: "ignore" });
    } catch {
      // ignore if git is not available
    }
  }

  // T6: the canonical .templatesyncignore baseline ships with the template and is
  // left untouched here; option-driven opt-outs append to it via ignoreSyncPath below.

  const gitAuthor = getGitConfig("user.name");
  const gitEmail = getGitConfig("user.email");
  const gitRemote = getGitRemoteInfo();
  const dirName = path.basename(process.cwd());
  const githubUser = getGitConfig("github.user");

  const defaultPkgName = gitRemote.repo === "" ? dirName : gitRemote.repo;
  const defaultOwner = gitRemote.owner === "" ? (githubUser === "" ? "your-username" : githubUser) : gitRemote.owner;
  const defaultAuthorName = gitAuthor === "" ? "Your Name" : gitAuthor;
  const defaultAuthorEmail = gitEmail === "" ? "you@example.com" : gitEmail;
  const defaultRepoName = defaultPkgName.replace(/^@[^/]+\//u, "");

  const name =
    initConfig?.name ?? (await promptValidated("Package name", defaultPkgName, validateNpmName("Package name")));
  const description =
    initConfig?.description ??
    (await promptValidated("Description", "A TypeScript Node package", validateNonEmpty("Description")));
  const authorName =
    initConfig?.authorName ??
    (await promptValidated("Author name", defaultAuthorName, validateNonEmpty("Author name")));
  const authorEmail =
    initConfig?.authorEmail ??
    (await promptValidated("Author email", defaultAuthorEmail, validateEmail("Author email")));
  const repoOwner =
    initConfig?.repoOwner ??
    (await promptValidated("GitHub username/org", defaultOwner, validateRepoIdentifier("GitHub username/org")));
  const unscopedName = name.replace(/^@[^/]+\//u, "");
  const fallbackRepoName = unscopedName === "" ? defaultRepoName : unscopedName;
  const repoName =
    initConfig?.repoName ??
    (await promptValidated(
      "GitHub repository name",
      fallbackRepoName,
      validateRepoIdentifier("GitHub repository name"),
    ));

  const context: TemplateContext = {
    name,
    repoOwner,
    repoName,
  };

  const isRebecca = isUserRebeccaStevens({
    authorName,
    authorEmail,
  });

  // T9: identity misconfiguration guard. The donation files are personal to
  // Rebecca Stevens; another author keeping them means the identity answers are wrong.
  if (!isRebecca) {
    const donationsExists = await fs
      .access(path.resolve("DONATIONS.md"))
      .then(() => true)
      .catch(() => false);
    const fundingExists = await fs
      .access(path.resolve(".github/FUNDING.yml"))
      .then(() => true)
      .catch(() => false);
    if (donationsExists && fundingExists) {
      throw new Error(
        "❌ Identity misconfiguration detected: the author is not Rebecca Stevens, but both DONATIONS.md and .github/FUNDING.yml exist in the target.\n" +
          "   These donation files are personal to Rebecca Stevens and cannot be kept by a different author.\n" +
          "   Aborting before any changes were made. Re-run with the correct author details, or remove the donation files first.",
      );
    }
  }

  // Config-mode booleans fall back to documented defaults when omitted; interactive
  // mode keeps its original prompts. A plain `??` cannot distinguish "omitted in
  // config" from "not in config mode", so resolve per-mode explicitly.
  const configTidelift = initConfig === null ? undefined : (initConfig.includeTidelift ?? isRebecca);
  const includeTidelift = configTidelift ?? (isRebecca ? await promptBoolean("Include Tidelift funding", true) : false);

  const licenseType =
    initConfig?.licenseType ??
    (isAdvanced
      ? await promptValidated("License [BSD-3-Clause / MIT / Apache-2.0 / UNLICENSED]", "BSD-3-Clause", validateLicense)
      : "BSD-3-Clause");

  const configTests = initConfig === null ? undefined : (initConfig.includeTests ?? true);
  const includeTests = configTests ?? (isAdvanced ? await promptBoolean("Include example tests", true) : true);
  const configJsr = initConfig === null ? undefined : (initConfig.includeJsr ?? true);
  const includeJsr =
    configJsr ?? (isAdvanced ? await promptBoolean("Include JSR publishing configuration", true) : true);
  const configRenovate = initConfig === null ? undefined : (initConfig.includeRenovate ?? true);
  const includeRenovate =
    configRenovate ?? (isAdvanced ? await promptBoolean("Include Renovate bot configuration", true) : true);
  const configCommitizen = initConfig === null ? undefined : (initConfig.includeCommitizen ?? true);
  const includeCommitizen =
    configCommitizen ??
    (isAdvanced ? await promptBoolean("Include Commitizen & Conventional Commits setup", true) : true);
  const configVSCode = initConfig === null ? undefined : (initConfig.includeVSCode ?? true);
  const includeVSCode =
    configVSCode ?? (isAdvanced ? await promptBoolean("Include VS Code configuration", true) : true);

  // T5: private now defaults to no — accidental private:true blocks npm publishing.
  const configPrivate = initConfig === null ? undefined : (initConfig.isPrivate ?? false);
  const isPrivate = configPrivate ?? (isAdvanced ? await promptBoolean("Set package as private", false) : false);

  if (isPrivate) {
    console.warn("⚠️  private:true blocks npm publishing");
  }

  // Snapshot every path this run may mutate so that a mid-run failure can be
  // rolled back atomically, leaving the target directory untouched.
  const mutatedPaths = getMutatedPaths({
    includeJsr,
    includeTests,
    includeCommitizen,
    includeVSCode,
    includeRenovate,
    isRebecca,
    includeTidelift,
  });
  const snapshot = await createSnapshot(mutatedPaths);

  try {
    // Update LICENSE file
    const licensePath = path.resolve("LICENSE");
    const licenseText = getLicenseText(licenseType, new Date().getFullYear(), authorName);
    if (licenseText === null) {
      try {
        await fs.unlink(licensePath);
      } catch {
        // ignore
      }
    } else {
      await fs.writeFile(licensePath, licenseText, "utf8");
    }

    // Remove test files, configs, and workflow if user opts out
    if (!includeTests) {
      try {
        await fs.rm(path.resolve("tests"), { recursive: true, force: true });
        await ignoreSyncPath("tests/**");
      } catch {
        // ignore
      }
      try {
        await fs.unlink(path.resolve("vitest.config.ts"));
        await ignoreSyncPath("vitest.config.ts");
      } catch {
        // ignore
      }
      try {
        await fs.unlink(path.resolve(".github/workflows/test-js.yml"));
        await ignoreSyncPath(".github/workflows/test-js.yml");
      } catch {
        // ignore
      }
      const releaseWfPath = path.resolve(".github/workflows/release.yml");
      try {
        const rawRelease = await fs.readFile(releaseWfPath, "utf8");

        const updatedRelease = rawRelease
          .replaceAll(/^[\t ]*test_js:\s*\n[\t ]*uses:\s*\.\/\.github\/workflows\/test-js\.yml[\t ]*\n?/gmu, "")
          .replaceAll(/^[\t ]*-[\t ]*test_js[\t ]*\n?/gmu, "");
        await fs.writeFile(releaseWfPath, updatedRelease, "utf8");
      } catch {
        // ignore
      }
      // Remove codecov config when tests are disabled
      try {
        await fs.unlink(path.resolve(".github/codecov.yml"));
        await ignoreSyncPath(".github/codecov.yml");
      } catch {
        // ignore
      }
      // Remove vitest debug config from launch.json. The body is brace-bounded so
      // only the test config object is removed; any configs after it survive.
      try {
        const launchPath = path.resolve(".vscode/launch.json");
        const launchRaw = await fs.readFile(launchPath, "utf8");
        const updatedLaunch = launchRaw.replace(
          // eslint-disable-next-line regexp/optimize-regex, regexp/no-useless-lazy, sonar/regex-complexity -- lazy one-level brace bounding is required to stop at the test config's own closing brace
          /,\s*\{\s*"name":\s*"[^"]*test[^"]*"(?:[^{}]|\{[^{}]*\})*?\}(?=\s*(?:,\s*\{|\]))/iu,
          "",
        );
        await fs.writeFile(launchPath, updatedLaunch, "utf8");
      } catch {
        // ignore
      }
      // Disable tests in eslint.config.js
      try {
        const eslintPath = path.resolve("eslint.config.js");
        const eslintRaw = await fs.readFile(eslintPath, "utf8");
        // eslint-disable-next-line regexp/optimize-regex
        const updatedEslint = eslintRaw.replace(/(rsEslint\(\s*\{)/u, "$1\n  test: false,");
        await fs.writeFile(eslintPath, updatedEslint, "utf8");
      } catch {
        // ignore
      }
    }

    // Handle JSR configuration
    if (includeJsr) {
      // Add JSR configuration if user opted in. The template's .releaserc.yml already
      // ships the plugin, so skip insertion when present to avoid a duplicate entry.
      const releasercPath = path.resolve(".releaserc.yml");
      try {
        const rawReleaserc = await fs.readFile(releasercPath, "utf8");
        const updatedReleaserc = rawReleaserc.includes("@sebbo2002/semantic-release-jsr")
          ? rawReleaserc
          : rawReleaserc.replace(
              /^(\s*-\s*["']@semantic-release\/npm["']\s*)$/mu,
              '$1\n  - "@sebbo2002/semantic-release-jsr"',
            );
        await fs.writeFile(releasercPath, updatedReleaserc, "utf8");
      } catch {
        // ignore
      }
    } else {
      try {
        await fs.unlink(path.resolve("jsr.json"));
      } catch {
        // ignore
      }
      // Remove the JSR plugin from .releaserc.yml when JSR is opted out; an
      // opted-out release would otherwise try to publish to JSR without jsr.json.
      const releasercPath = path.resolve(".releaserc.yml");
      try {
        const rawReleaserc = await fs.readFile(releasercPath, "utf8");

        const updatedReleaserc = rawReleaserc.replaceAll(
          /^[\t ]*-[\t ]*["']@sebbo2002\/semantic-release-jsr["'][\t ]*\n?/gmu,
          "",
        );
        await fs.writeFile(releasercPath, updatedReleaserc, "utf8");
      } catch {
        // ignore
      }
    }

    // Remove Renovate configuration if user opts out
    if (!includeRenovate) {
      try {
        await fs.unlink(path.resolve(".github/renovate.json"));
        await ignoreSyncPath(".github/renovate.json");
      } catch {
        // ignore
      }
    }

    // Remove Commitizen / Conventional Commits setup if user opts out
    if (!includeCommitizen) {
      try {
        await fs.unlink(path.resolve(".czrc"));
        await ignoreSyncPath(".czrc");
      } catch {
        // ignore
      }
      try {
        await fs.unlink(path.resolve(".commitlintrc.cjs"));
        await ignoreSyncPath(".commitlintrc.cjs");
      } catch {
        // ignore
      }
      // Remove the husky commit-msg hook that depends on commitlint
      try {
        await fs.unlink(path.resolve(".husky/commit-msg"));
        await ignoreSyncPath(".husky/commit-msg");
      } catch {
        // ignore
      }
    }

    // Remove VS Code configuration if user opts out
    if (!includeVSCode) {
      try {
        await fs.rm(path.resolve(".vscode"), { recursive: true, force: true });
        await ignoreSyncPath(".vscode/**");
      } catch {
        // ignore
      }
    }

    // Update package.json immutably
    const pkgPath = path.resolve("package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(pkgContent) as PackageJson;

    const { init: _initScript, cz: _czScript, prepublishOnly: _prepublish, ...remainingScripts } = pkg.scripts;
    const { bin: _bin, funding: _funding, ...pkgWithoutBinAndFunding } = pkg;

    const initialScripts: Record<string, string> = {
      ...remainingScripts,
      ...(includeCommitizen ? { cz: "git-cz" } : {}),
    };

    const finalScripts = includeTests
      ? initialScripts
      : Object.fromEntries(Object.entries(initialScripts).filter(([key]) => !/^test(?::|$)/u.test(key)));

    const finalDevDependencies =
      pkg.devDependencies === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(pkg.devDependencies).filter(
              ([key]) =>
                (includeTests || !TEST_DEV_DEP_PATTERNS.some((pattern) => pattern.test(key))) &&
                (includeCommitizen || !COMMITIZEN_DEV_DEP_PATTERNS.some((pattern) => pattern.test(key))),
            ),
          );

    // Per the npm docs, only list what isn't already always included: package.json, README (and variants),
    // LICENSE (and variants), the "main" file and the "bin" files are bundled regardless of the "files" field.
    // T8: an existing files array is preserved; ["dist/"] is only injected when the field is absent.
    const finalFiles = pkg.files === undefined ? ["dist/"] : [...pkg.files];

    const updatedFunding = isRebecca
      ? pkg.funding
          ?.filter((f) => includeTidelift || f["type"] !== "tidelift")
          .map((f) =>
            f["url"] === undefined
              ? f
              : {
                  ...f,
                  url: f["url"].replaceAll("package_name", name).replaceAll("RebeccaStevens", repoOwner),
                },
          )
      : undefined;

    const updatedPkg: PackageJson = {
      ...pkgWithoutBinAndFunding,
      name,
      private: isPrivate,
      description,
      license: licenseType.trim(),
      author: { name: authorName, email: authorEmail },
      homepage: `https://github.com/${repoOwner}/${repoName}#readme`,
      bugs: { url: `https://github.com/${repoOwner}/${repoName}/issues` },
      repository: {
        type: "git",
        url: `git+https://github.com/${repoOwner}/${repoName}.git`,
      },
      ...(updatedFunding === undefined ? {} : { funding: updatedFunding }),
      files: finalFiles,
      scripts: finalScripts,
      devDependencies: finalDevDependencies,
    };

    await fs.writeFile(pkgPath, `${JSON.stringify(updatedPkg, null, 2)}\n`, "utf8");

    // Update jsr.json immutably
    if (includeJsr) {
      const jsrPath = path.resolve("jsr.json");
      try {
        const jsrContent = await fs.readFile(jsrPath, "utf8");
        const jsr = JSON.parse(jsrContent) as JsrJson;
        const publish = jsr["publish"] as { include?: string[] } | undefined;
        const updatedJsr: JsrJson = {
          ...jsr,
          name: name.startsWith("@") ? name : `@${repoOwner}/${name}`,
          ...(licenseText === null && publish?.include !== undefined
            ? {
                publish: {
                  ...publish,
                  include: publish.include.filter((f) => f !== "LICENSE"),
                },
              }
            : {}),
        };
        await fs.writeFile(jsrPath, `${JSON.stringify(updatedJsr, null, 2)}\n`, "utf8");
      } catch {
        // ignore if jsr.json doesn't exist
      }
    }

    // Update text files
    await updateReadme(
      path.resolve("README.md"),
      context,
      includeJsr,
      isRebecca,
      includeTidelift,
      licenseType,
      includeTests,
      includeCommitizen,
    );

    await updateAgentsMd(path.resolve("AGENTS.md"));

    if (isRebecca) {
      await updateDonations(path.resolve("DONATIONS.md"), context, includeTidelift);
      await updateFundingYml(path.resolve(".github/FUNDING.yml"), context, includeTidelift);
    } else {
      try {
        await fs.unlink(path.resolve("DONATIONS.md"));
      } catch {
        // ignore
      }
      try {
        await fs.unlink(path.resolve(".github/FUNDING.yml"));
      } catch {
        // ignore
      }
    }

    if (!isRebecca || !includeTidelift) {
      try {
        await fs.unlink(path.resolve("SECURITY.md"));
      } catch {
        // ignore
      }
    }

    // Self-cleanup: remove scripts directory
    try {
      const scriptsDir = path.resolve("scripts");
      await fs.rm(scriptsDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }

    // T7: remove CHANGELOG.md only when it still carries template placeholders/markers;
    // a consumer-customized changelog is preserved.
    const changelogPath = path.resolve("CHANGELOG.md");
    try {
      const changelogRaw = await fs.readFile(changelogPath, "utf8");
      if (changelogRaw.includes("package_name") || changelogRaw.includes("<!-- template-")) {
        await fs.unlink(changelogPath);
      } else {
        console.log("ℹ️  Preserving existing CHANGELOG.md (no template markers found).");
      }
    } catch {
      // ignore if CHANGELOG.md doesn't exist
    }

    // Remove dead ESLint ignore for scripts/init.js
    try {
      const eslintConfigPath = path.resolve("eslint.config.js");
      const eslintRaw = await fs.readFile(eslintConfigPath, "utf8");
      // eslint-disable-next-line regexp/optimize-regex
      const updated = eslintRaw.replaceAll(/\s*ignores:\s*\["scripts\/init\.js"\],?\n?/gu, "\n");
      await fs.writeFile(eslintConfigPath, updated, "utf8");
    } catch {
      // ignore
    }
  } catch (error) {
    const restoreError = await tryRestoreSnapshot(snapshot);
    if (restoreError === undefined) {
      await discardSnapshot(snapshot);
    }
    const rawMessage = typeof error === "object" && error !== null && "message" in error ? error.message : error;
    if (restoreError !== undefined) {
      const rawRestoreMessage =
        typeof restoreError === "object" && restoreError !== null && "message" in restoreError
          ? restoreError.message
          : restoreError;
      throw new Error(
        `❌ Initialization failed and rollback also failed; snapshot preserved at ${snapshot.tempDir}.\n` +
          `Original error: ${String(rawMessage)}\n` +
          `Rollback error: ${String(rawRestoreMessage)}`,
      );
    }
    throw new Error(`❌ Initialization failed; changes rolled back.\n${String(rawMessage)}`);
  }
  await discardSnapshot(snapshot);

  console.log("\n✅ Template initialized successfully!\n");
  console.log("📦 Installing dependencies and formatting files...\n");

  try {
    execSync("pnpm install --ignore-scripts", { stdio: "inherit" });
    execSync("pnpm run lint-fix", { stdio: "ignore" });
  } catch {
    console.error(
      "⚠️  Failed to install dependencies or format files. You may need to run `pnpm install` and `pnpm run lint-fix` manually.",
    );
  }

  try {
    execSync("git add .", { stdio: "ignore" });
    execSync('git commit -m "chore: initial commit"', { stdio: "ignore" });
  } catch {
    // ignore
  }
} catch (error) {
  const rawMessage = typeof error === "object" && error !== null && "message" in error ? error.message : error;
  console.error(String(rawMessage));
  process.exitCode = 1;
} finally {
  rl.close();
}
