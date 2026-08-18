#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
const TEST_DEV_DEP_PATTERNS = [/^vitest$/u, /^@vitest\//u, /^eslint-plugin-no-only-tests$/u];
const COMMITIZEN_DEV_DEP_PATTERNS = [/^@commitlint\//u, /^commitizen$/u, /^cz-/u];
const TEST_SCRIPT_KEYS = new Set(["test", "test:js", "test:js-run", "test:js-watch", "test:coverage"]);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
/**
 * Normalizes a string by trimming, lowercasing, and collapsing whitespace.
 *
 * @param str - Input string.
 * @returns Normalized string.
 */
function normalize(str) {
    return str.trim().toLowerCase().replaceAll(/\s+/gu, " ");
}
/**
 * Strips a delimited comment block from text.
 *
 * @param content - Input text.
 * @param blockName - Name of block tag (e.g. "template-tidelift").
 * @returns Text with block removed.
 */
function removeBlock(content, blockName) {
    const regex = new RegExp(`<!--\\s*${blockName}-start\\s*-->.*?<!--\\s*${blockName}-end\\s*-->\\n?`, "gsu");
    return content.replaceAll(regex, "");
}
/**
 * Strips all remaining template comment tags from text and normalizes spacing.
 *
 * @param content - Input text.
 * @returns Clean text without template marker comments.
 */
function stripRemainingCommentMarkers(content) {
    const stripped = content.replaceAll(/<!--\s*template-[a-z-]+-(?:start|end)\s*-->\n?/gu, "");
    return `${stripped.replaceAll(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}
/**
 * Replaces standard template repository placeholders in the correct topological order.
 *
 * @param content - The source string.
 * @param context - Template naming and repository metadata.
 * @returns String with all template placeholders updated.
 */
function replacePlaceholders(content, context) {
    const jsrPkgName = context.name.startsWith("@") ? context.name : `@${context.repoOwner}/${context.name}`;
    return content
        .replaceAll("# Template for my Node Packages", `# ${context.name}`)
        .replaceAll("img.shields.io/jsr/v/package_name.svg", `img.shields.io/jsr/v/${jsrPkgName}.svg`)
        .replaceAll("jsr.io/package_name", `jsr.io/${jsrPkgName}`)
        .replaceAll("jsr:package_name", `jsr:${jsrPkgName}`)
        .replaceAll("jsr add package_name", `jsr add ${jsrPkgName}`)
        .replaceAll("RebeccaStevens/template-typescript-node-package", `${context.repoOwner}/${context.repoName}`)
        .replaceAll("package_name", context.name)
        .replaceAll("RebeccaStevens", context.repoOwner);
}
/**
 * Executes a git command and returns the trimmed output.
 *
 * @param key - The git config key to query.
 * @returns The trimmed string value or empty string.
 */
function getGitConfig(key) {
    try {
        return execSync(`git config --get ${key}`, { encoding: "utf8" }).trim();
    }
    catch {
        return "";
    }
}
/**
 * Extracts owner and repo name from git remote origin URL.
 *
 * @returns Object containing owner and repo strings.
 */
function getGitRemoteInfo() {
    const url = getGitConfig("remote.origin.url");
    if (url === "") {
        return { owner: "", repo: "" };
    }
    const match = /github\.com[/:]([^/]+)\/([^./]+)(?:\.git)?/u.exec(url);
    if (match !== null) {
        return { owner: match[1] ?? "", repo: match[2] ?? "" };
    }
    return { owner: "", repo: "" };
}
/**
 * Prompts the user for input with a default value.
 *
 * @param question - Question text to display.
 * @param defaultValue - Fallback default value.
 * @returns User response or default value.
 */
async function prompt(question, defaultValue) {
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
async function promptBoolean(question, defaultYes) {
    const defaultHint = defaultYes ? "Y/n" : "y/N";
    const answer = await rl.question(`${question} [${defaultHint}]: `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "") {
        return defaultYes;
    }
    return trimmed === "y" || trimmed === "yes";
}
/**
 * Generates license text based on choice.
 *
 * @param licenseType - Chosen license name.
 * @param year - Copyright year.
 * @param authorName - Copyright author.
 * @returns License text or null if UNLICENSED.
 */
function getLicenseText(licenseType, year, authorName) {
    const norm = licenseType.trim().toUpperCase();
    if (norm === "MIT") {
        return `MIT License\n\nCopyright (c) ${year} ${authorName}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
    }
    if (norm === "BSD-3-CLAUSE" || norm === "BSD") {
        return `BSD 3-Clause License\n\nCopyright (c) ${year}, ${authorName}\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.\n\n3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
    }
    if (norm === "APACHE-2.0" || norm === "APACHE") {
        return `Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n\nCopyright ${year} ${authorName}\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n`;
    }
    return null;
}
/**
 * Uniquely determines if the user running initialization is Rebecca Stevens.
 *
 * @param info - Author name and email identity details.
 * @returns True if and only if both the author name and email match Rebecca Stevens.
 */
function isUserRebeccaStevens(info) {
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
 */
async function updateReadme(filePath, context, includeJsr, isRebecca, includeTidelift) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const withoutInit = removeBlock(raw, "template-init");
        const withoutJsr = includeJsr
            ? withoutInit
            : removeBlock(removeBlock(withoutInit, "template-jsr-badge"), "template-jsr-install");
        const withoutDonationsOrTidelift = isRebecca
            ? includeTidelift
                ? withoutJsr
                : removeBlock(withoutJsr, "template-tidelift")
            : removeBlock(withoutJsr, "template-donations");
        const replaced = replacePlaceholders(withoutDonationsOrTidelift, context);
        const finalContent = stripRemainingCommentMarkers(replaced);
        await fs.writeFile(filePath, finalContent, "utf8");
    }
    catch {
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
async function updateDonations(filePath, context, includeTidelift) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const filtered = includeTidelift ? raw : removeBlock(raw, "template-tidelift");
        const replaced = replacePlaceholders(filtered, context);
        const finalContent = stripRemainingCommentMarkers(replaced);
        await fs.writeFile(filePath, finalContent, "utf8");
    }
    catch {
        // ignore if DONATIONS.md doesn't exist
    }
}
/**
 * Helper to update .github/FUNDING.yml by updating placeholders and conditionally removing Tidelift.
 *
 * @param filePath - Path to .github/FUNDING.yml.
 * @param context - Template naming and repository metadata.
 * @param includeTidelift - Whether Tidelift funding is included.
 */
async function updateFundingYml(filePath, context, includeTidelift) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const filtered = includeTidelift ? raw : raw.replaceAll(/^\s*tidelift:\s*(?:\S.*)?\n/gmu, "");
        const finalContent = replacePlaceholders(filtered, context);
        await fs.writeFile(filePath, finalContent, "utf8");
    }
    catch {
        // ignore if FUNDING.yml doesn't exist
    }
}
try {
    console.log("\n🚀 Initializing package from template...\n");
    const isAdvanced = process.argv.includes("--advanced") || process.argv.includes("-a");
    // Handle npx positional target directory argument (e.g. npx ... my-new-package)
    const positionalArg = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
    const targetArg = positionalArg;
    if (targetArg !== undefined && targetArg.trim() !== "") {
        const targetPath = path.resolve(targetArg.trim());
        const sourcePath = process.cwd();
        if (targetPath !== sourcePath) {
            console.log(`📁 Target directory specified: ${targetArg.trim()}\n`);
            await fs.mkdir(targetPath, { recursive: true });
            await fs.cp(sourcePath, targetPath, {
                recursive: true,
                filter: (src) => {
                    const relative = path.relative(sourcePath, src);
                    return (!relative.startsWith("node_modules") &&
                        !relative.startsWith("dist") &&
                        !relative.startsWith("coverage") &&
                        !relative.startsWith(".git/") &&
                        relative !== ".git");
                },
            });
            process.chdir(targetPath);
            try {
                execSync("git init", { stdio: "ignore" });
            }
            catch {
                // ignore if git is not available
            }
        }
    }
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
    const name = await prompt("Package name", defaultPkgName);
    const description = await prompt("Description", "A TypeScript Node package");
    const authorName = await prompt("Author name", defaultAuthorName);
    const authorEmail = await prompt("Author email", defaultAuthorEmail);
    const repoOwner = await prompt("GitHub username/org", defaultOwner);
    const unscopedName = name.replace(/^@[^/]+\//u, "");
    const fallbackRepoName = unscopedName === "" ? defaultRepoName : unscopedName;
    const repoName = await prompt("GitHub repository name", fallbackRepoName);
    const context = {
        name,
        repoOwner,
        repoName,
    };
    const isRebecca = isUserRebeccaStevens({
        authorName,
        authorEmail,
    });
    const includeTidelift = isRebecca ? await promptBoolean("Include Tidelift funding", true) : false;
    const licenseType = isAdvanced
        ? await prompt("License [BSD-3-Clause / MIT / Apache-2.0 / UNLICENSED]", "BSD-3-Clause")
        : "BSD-3-Clause";
    const includeTests = isAdvanced ? await promptBoolean("Include example tests", true) : true;
    const includeJsr = isAdvanced ? await promptBoolean("Include JSR publishing configuration", true) : true;
    const includeRenovate = isAdvanced ? await promptBoolean("Include Renovate bot configuration", true) : true;
    const includeCommitizen = isAdvanced
        ? await promptBoolean("Include Commitizen & Conventional Commits setup", true)
        : true;
    // Update LICENSE file
    const licensePath = path.resolve("LICENSE");
    const licenseText = getLicenseText(licenseType, new Date().getFullYear(), authorName);
    if (licenseText === null) {
        try {
            await fs.unlink(licensePath);
        }
        catch {
            // ignore
        }
    }
    else {
        await fs.writeFile(licensePath, licenseText, "utf8");
    }
    // Remove test files, configs, and workflow if user opts out
    if (!includeTests) {
        try {
            await fs.rm(path.resolve("tests"), { recursive: true, force: true });
        }
        catch {
            // ignore
        }
        try {
            await fs.unlink(path.resolve("vitest.config.ts"));
        }
        catch {
            // ignore
        }
        try {
            await fs.unlink(path.resolve(".github/workflows/test-js.yml"));
        }
        catch {
            // ignore
        }
        const releaseWfPath = path.resolve(".github/workflows/release.yml");
        try {
            const rawRelease = await fs.readFile(releaseWfPath, "utf8");
            const updatedRelease = rawRelease
                .replaceAll(/^\s*test_js:[\t\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*uses:\s*\.\/\.github\/workflows\/test-js\.yml\s*/gmu, "")
                .replaceAll(/^\s*-\s*test_js\s*/gmu, "");
            await fs.writeFile(releaseWfPath, updatedRelease, "utf8");
        }
        catch {
            // ignore
        }
    }
    // Remove JSR configuration if user opts out
    if (!includeJsr) {
        try {
            await fs.unlink(path.resolve("jsr.json"));
        }
        catch {
            // ignore
        }
        const releasercPath = path.resolve(".releaserc.yml");
        try {
            const rawReleaserc = await fs.readFile(releasercPath, "utf8");
            const updatedReleaserc = rawReleaserc.replaceAll(/^\s*-\s*["']?@sebbo2002\/semantic-release-jsr["']?\s*/gmu, "");
            await fs.writeFile(releasercPath, updatedReleaserc, "utf8");
        }
        catch {
            // ignore
        }
    }
    // Remove Renovate configuration if user opts out
    if (!includeRenovate) {
        try {
            await fs.unlink(path.resolve(".github/renovate.json"));
        }
        catch {
            // ignore
        }
    }
    // Remove Commitizen / Conventional Commits setup if user opts out
    if (!includeCommitizen) {
        try {
            await fs.unlink(path.resolve(".czrc"));
        }
        catch {
            // ignore
        }
        try {
            await fs.unlink(path.resolve(".commitlintrc.cjs"));
        }
        catch {
            // ignore
        }
    }
    // Update package.json immutably
    const pkgPath = path.resolve("package.json");
    const pkgContent = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(pkgContent);
    const { init: _initScript, cz: _czScript, ...remainingScripts } = pkg.scripts;
    const { bin: _bin, funding: _funding, ...pkgWithoutBinAndFunding } = pkg;
    const initialScripts = {
        ...remainingScripts,
        ...(includeCommitizen ? { cz: "git-cz" } : {}),
    };
    const filteredScripts = !includeJsr && initialScripts["release"] !== undefined
        ? {
            ...initialScripts,
            release: initialScripts["release"].replaceAll(/\s*--package\s+@sebbo2002\/semantic-release-jsr/gu, ""),
        }
        : initialScripts;
    const finalScripts = includeTests
        ? filteredScripts
        : Object.fromEntries(Object.entries(filteredScripts).filter(([key]) => !TEST_SCRIPT_KEYS.has(key)));
    const finalDevDependencies = pkg.devDependencies === undefined
        ? undefined
        : Object.fromEntries(Object.entries(pkg.devDependencies).filter(([key]) => (includeTests || !TEST_DEV_DEP_PATTERNS.some((pattern) => pattern.test(key))) &&
            (includeCommitizen || !COMMITIZEN_DEV_DEP_PATTERNS.some((pattern) => pattern.test(key)))));
    const finalFiles = !includeJsr && pkg.files !== undefined ? pkg.files.filter((f) => f !== "jsr.json") : pkg.files;
    const updatedFunding = isRebecca
        ? pkg.funding
            ?.filter((f) => includeTidelift || f["type"] !== "tidelift")
            .map((f) => f["url"] === undefined
            ? f
            : { ...f, url: f["url"].replaceAll("package_name", name).replaceAll("RebeccaStevens", repoOwner) })
        : undefined;
    const updatedPkg = {
        ...pkgWithoutBinAndFunding,
        name,
        description,
        license: licenseType.trim(),
        author: { name: authorName, email: authorEmail },
        homepage: `https://github.com/${repoOwner}/${repoName}#readme`,
        bugs: { url: `https://github.com/${repoOwner}/${repoName}/issues` },
        repository: { type: "git", url: `git+https://github.com/${repoOwner}/${repoName}.git` },
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
            const jsr = JSON.parse(jsrContent);
            const updatedJsr = {
                ...jsr,
                name: name.startsWith("@") ? name : `@${repoOwner}/${name}`,
            };
            await fs.writeFile(jsrPath, `${JSON.stringify(updatedJsr, null, 2)}\n`, "utf8");
        }
        catch {
            // ignore if jsr.json doesn't exist
        }
    }
    // Update text files
    await updateReadme(path.resolve("README.md"), context, includeJsr, isRebecca, includeTidelift);
    if (isRebecca) {
        await updateDonations(path.resolve("DONATIONS.md"), context, includeTidelift);
        await updateFundingYml(path.resolve(".github/FUNDING.yml"), context, includeTidelift);
    }
    else {
        try {
            await fs.unlink(path.resolve("DONATIONS.md"));
        }
        catch {
            // ignore
        }
        try {
            await fs.unlink(path.resolve(".github/FUNDING.yml"));
        }
        catch {
            // ignore
        }
    }
    if (!isRebecca || !includeTidelift) {
        try {
            await fs.unlink(path.resolve("SECURITY.md"));
        }
        catch {
            // ignore
        }
    }
    // Self-cleanup: remove scripts/init.ts and remove scripts directory if empty
    const initScriptPath = path.resolve("scripts/init.ts");
    try {
        await fs.unlink(initScriptPath);
        const scriptsDir = path.resolve("scripts");
        const remainingFiles = await fs.readdir(scriptsDir);
        if (remainingFiles.length === 0) {
            await fs.rmdir(scriptsDir);
        }
    }
    catch {
        // ignore cleanup errors
    }
    console.log("\n✅ Template initialized successfully!\n");
}
finally {
    rl.close();
}
