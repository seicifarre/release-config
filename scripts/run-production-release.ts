#!/usr/bin/env npx ts-node

import {
  exec as execCb,
  execFile as execFileCb,
  ExecFileOptions,
  ExecOptions
} from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import semver from "semver";
import {
  uniqueNamesGenerator,
  adjectives,
  animals
} from "unique-names-generator";

// Promisificamos ambos
const exec = promisify(execCb);
const execFile = promisify(execFileCb);

// --- Configuration ---
const conventionalPreset: string = "angular";
const customFilePath: string = "ngsw-config.json";
const customFileVersionPath: string = "appData.version"; // Used for JSON update logic
const changelogFile: string = "CHANGELOG.md";
// --- End Configuration ---

// --- Refactored Helper Function to Execute Commands ---
async function runCommand(
  command: string,
  args: string[] = [],
  options: (ExecOptions | ExecFileOptions) & {
    ignoreStderr?: boolean;
    useShell?: boolean;
  } = {} // Añadimos useShell
): Promise<string> {
  const commandString =
    args.length > 0 ? `${command} ${args.join(" ")}` : command; // Construir string para logs/errores
  console.log(`$ ${commandString}`);

  try {
    const defaultOptions = { encoding: "utf-8", ...options };
    let stdout: string;
    let stderr: string | undefined;

    if (options.useShell) {
      // --- Usar exec (con shell) ---
      // exec necesita la cadena completa del comando
      const result = await exec(commandString, defaultOptions as ExecOptions);
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      // --- Usar execFile (sin shell) ---
      const result = await execFile(
        command,
        args,
        defaultOptions as ExecFileOptions
      ); // Aseguramos el tipo de options
      stdout = result.stdout;
      stderr = result.stderr;
    }

    if (stderr && !options.ignoreStderr) {
      if (!stderr.includes("warning:") && !stderr.includes("hint:")) {
        console.error("stderr:", stderr.trim());
      }
    }
    return stdout.trim();
  } catch (error: any) {
    const errorOutput: string =
      error.stderr ||
      error.stdout ||
      (error instanceof Error ? error.message : String(error));
    const wrappedError = new Error(
      `Error executing command ${commandString}":\n${errorOutput}`
    );
    if (error instanceof Error) {
      wrappedError.stack = error.stack;
    }
    throw wrappedError;
  }
}

// Interface for package.json
interface PackageJson {
  version: string;
  [key: string]: any;
}

// Helper Function to Update Version in Custom File (JSON Parse/Modify)
async function updateCustomFileVersion(
  filePath: string,
  jsonPath: string,
  newVersion: string
): Promise<void> {
  console.log(
    `   🔄 Updating version in ${filePath} (expected in ${jsonPath}) to ${newVersion} [Method: Parse/Modify]...`
  );
  try {
    const fileContent: string = await readFile(filePath, "utf-8");
    const jsonObject: any = JSON.parse(fileContent);
    const keys: string[] = jsonPath.split(".");
    let currentLevel: any = jsonObject;
    for (let i = 0; i < keys.length - 1; i++) {
      if (currentLevel[keys[i]] === undefined)
        throw new Error(`The key '${keys[i]}' does not exist.`);
      currentLevel = currentLevel[keys[i]];
    }
    const finalKey: string = keys[keys.length - 1];
    if (currentLevel[finalKey] === undefined)
      throw new Error(`The final key '${finalKey}' does not exist.`);
    const oldVersion: any = currentLevel[finalKey];
    currentLevel[finalKey] = newVersion;
    const updatedJsonContent: string = JSON.stringify(jsonObject, null, 2);
    await writeFile(filePath, updatedJsonContent, "utf-8");
    console.log(
      `   ✅ Updated version in ${filePath} (from ${oldVersion} to ${newVersion}).`
    );
  } catch (error: any) {
    console.error(
      `   ❌ Error updating ${filePath} using Parse/Modify:`,
      error.message
    );
    if (error instanceof SyntaxError)
      console.error(
        "   -> Possible problem: The file does not contain valid JSON."
      );
    throw new Error(
      `Failed to update version in ${filePath} using Parse/Modify.`
    );
  }
}

// --- Start of Main Script ---
async function runProductionRelease(): Promise<void> {
  let currentBranch: string = "";
  let releaseBranch: string = "";
  let nextVersion: string = "";

  try {
    console.log(
      "--- Starting the Production Release Process (Multiplatform) ---"
    );

    // --- Cross-platform npm command ---
    const useShell: boolean = process.platform === "win32";

    // === STEP 1: Preliminary Checks ===
    console.log("[1/7] Performing pre-checks...");
    currentBranch = await runCommand("git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
    const status: string = await runCommand("git", ["status", "--porcelain"]);
    if (status)
      throw new Error("❌ Error: The working directory is not clean.");
    if (currentBranch !== "develop")
      throw new Error(
        `❌ Error: You must be in 'develop' (current branch: ${currentBranch}).`
      );
    console.log("    🔄 Updating branches and tags...");
    await runCommand("git", ["pull", "origin", "develop"]);
    await runCommand("git", ["pull", "--ff-only", "origin", "master"]); // We keep --ff-only
    await runCommand("git", ["fetch", "--tags", "origin"], {
      ignoreStderr: true
    });
    console.log("✅ Prerequisites met.");

    // === STEP 2: Determine Release Version from Develop ===
    console.log("[2/7] Determining release version from development...");
    const __filename: string = fileURLToPath(import.meta.url);
    const __dirname: string = path.dirname(__filename);
    const packageJsonPath: string = path.resolve(__dirname, "../package.json");
    let currentDevVersion: string;
    try {
      const localPackageJsonContent: string = await readFile(
        packageJsonPath,
        "utf-8"
      );
      const localPkg: PackageJson = JSON.parse(localPackageJsonContent);
      currentDevVersion = localPkg.version;
      console.log(
        `    ℹ️ Current version in develop (package.json): ${currentDevVersion}`
      );
    } catch (error: any) {
      throw new Error(
        `❌ Error: Could not read local package.json version: ${error.message}`
      );
    }
    if (!semver.valid(currentDevVersion))
      throw new Error(
        `❌ Error: Version ${currentDevVersion} is not a valid SemVer.`
      );

    if (semver.prerelease(currentDevVersion)) {
      const hyphenIndex: number = currentDevVersion.indexOf("-");
      if (hyphenIndex > 0) {
        nextVersion = currentDevVersion.substring(0, hyphenIndex);
        console.log(
          `    ℹ️ This is a pre-release. Extracted base version: ${nextVersion}`
        );
      } else {
        throw new Error(
          `❌ Error: Pre-release tag detected but no script found in ${currentDevVersion}`
        );
      }
    } else {
      nextVersion = currentDevVersion;
      console.log(
        `    ℹ️ This is not a pre-release. Using the current version: ${nextVersion}`
      );
    }
    if (!semver.valid(nextVersion))
      throw new Error(
        `❌ Error: Calculated final version (${nextVersion}) is not valid SemVer.`
      );
    console.log(`✅ Version for this production release: ${nextVersion}`);

    // === STEP 3: Start Git Flow Release ===
    console.log(`[3/7] Starting 'git flow release start ${nextVersion}'...`);
    releaseBranch = `release/${nextVersion}`;
    // We use 'git' as command and ['flow', 'release', 'start', version] as arguments
    await runCommand("git", ["flow", "release", "start", nextVersion]);
    console.log(`✅ Branch ${releaseBranch} created and active.`);

    // === STEP 4: Prepare Release Branch Content ===
    console.log(`[4/7] Preparing content for the ${releaseBranch} branch...`);
    // 4.1. Update package.json
    console.log(
      `   [4.1] Updating version in package.json to ${nextVersion}...`
    );
    await runCommand(
      useShell ? "npm.cmd" : "npm",
      ["version", nextVersion, "--no-git-tag-version", "--allow-same-version"],
      { useShell }
    );
    console.log(`      ✅ package.json and package-lock.json updated.`);
    // 4.2. Update custom file
    console.log(`   [4.2] Updating version on ${customFilePath}...`);
    await updateCustomFileVersion(
      customFilePath,
      customFileVersionPath,
      nextVersion
    );
    // 4.3. Update CHANGELOG.md
    console.log(`   [4.3] Generating/Updating ${changelogFile}...`);
    // We use npx as the main command to run conventional-changelog
    await runCommand(
      useShell ? "npx.cmd" : "npx",
      [
        "conventional-changelog",
        "-p",
        conventionalPreset,
        "-i",
        changelogFile,
        "-s",
        "--pkg",
        "./package.json"
      ],
      { useShell }
    );
    console.log(`      ✅ ${changelogFile} updated.`);
    // 4.4. Staging
    console.log(`   [4.4] Adding modified files to the staging area...`);
    const filesToAdd: string[] = [
      "package.json",
      "package-lock.json",
      customFilePath,
      changelogFile
    ];
    await runCommand("git", ["add", ...filesToAdd]);
    console.log(`      ✅ Files prepared.`);
    // 4.5. Commit
    console.log(`   [4.5] Creating staging commit...`);
    const commitMessage: string = `chore(release): prepare release v${nextVersion}`;
    await runCommand("git", ["commit", "-m", commitMessage]);
    console.log(`      ✅ Commit created: ${commitMessage}`);
    console.log(`✅ Contents of branch ${releaseBranch} prepared.`);

    // === STEP 5: Finalize Git Flow Release (Locally) and Push Manually ===
    console.log(
      `[5/7] Finishing 'git flow release finish v${nextVersion}' locally...`
    );

    // We execute finish WITHOUT -p and with the message without spaces for the tag/merge.
    const messageNoSpaces: string = `Release_v${nextVersion}`; // Simple message without spaces

    const finishArgs: string[] = [
      "flow",
      "release",
      "finish",
      "-m", // We use -m with message without spaces
      messageNoSpaces,
      nextVersion // We pass version WITHOUT 'v'
    ];

    console.log(`   Running: git ${finishArgs.join(" ")}`);
    // We run WITHOUT GIT_EDITOR=true, relying on -m
    await runCommand("git", finishArgs);
    console.log(
      `   ✅ Git flow release finished locally (merges, local tag, local deletion of release branch).`
    );

    // Now, we explicitly push what is needed: master, develop and the tags
    console.log(`   [5.1] Pushing updated master branch to origin...`);
    await runCommand("git", ["push", "origin", "master"]);

    console.log(`   [5.2] Pushing updated develop branch to origin...`);
    await runCommand("git", ["push", "origin", "develop"]);

    console.log(`   [5.3] Pushing tags to origin...`);
    // We use --tags to push all local tags that are not on the remote
    // This includes the newly created tag '1.0.7' (or 'v1.0.7' if git flow prefixed it).
    await runCommand("git", ["push", "--tags", "origin"]);

    console.log(`✅ Master, develop, and tag branches pushed to origin.`);
    // --- End of STEP 5 ---

    // === STEP 6: Create Release on GitHub ===
    // The tag was already created and pushed by 'git flow release finish -p' in the previous step
    const tagName: string = `v${nextVersion}`; // We build the expected tag name

    // Title for the GitHub release
    const releaseTitle: string = uniqueNamesGenerator({
      // You can combine dictionaries: Adjective + Color + Animal, etc.
      dictionaries: [adjectives, animals], // -> "Quirky Badger"
      // dictionaries: [adjectives, colors, animals], -> "Large Red Bear"
      // dictionaries: [starWars], // -> "Ackbar" (explore the available dictionaries!)
      separator: " ", // Separator between words
      style: "capital", // Capitalize each word
      length: 2 // Number of words to generate (if you use multiple dictionaries)
    });

    console.log(
      `[6/7] Creating a GitHub release for the ${tagName} tag (Title: ${releaseTitle})...`
    );

    // We use 'gh release create'
    // - tagName: The tag we just created and pushed.
    // - --title: The title of the release on GitHub.
    // - -F or --notes-file: Use the contents of CHANGELOG.md as the body of the release.
    // - We don't use --prerelease because this is a final release.
    // - gh CLI will use the configured authentication (via gh auth login).
    await runCommand("gh", [
      "release",
      "create",
      tagName,
      "--title",
      releaseTitle,
      "--notes-file",
      changelogFile
    ]);

    console.log(`✅ Release ${releaseTitle} created on GitHub.`);
    // --- End of STEP 6 ---

    // === STEP 7: Update Develop Branch ===
    console.log("[7/7] Preparing the develop branch for the next cycle...");

    // 7.1. Make sure you're in develop (git flow finish should leave us here, but for safety)
    console.log(`   [7.1] Checking and switching to develop if necessary...`);
    let finalBranch: string = await runCommand("git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
    if (finalBranch !== "develop") {
      console.warn(
        `   ⚠️ We weren't in develop (we were in ${finalBranch}). Switching to develop...`
      );
      await runCommand("git", ["checkout", "develop"]);
      // We could do an extra pull just in case, although git flow finish already merged
      // await runCommand('git', ['pull', 'origin', 'develop']);
    }
    console.log(`      ✅ In the develop branch.`);

    // 7.2. Increase version to the next pre-release (-dev.0)
    console.log(
      `   [7.2] Incrementing version to the next pre-release in package.json...`
    );
    // npm version prerelease increments the last number and adds -dev.0
    // or increments the .N if it already exists -dev.N
    await runCommand(
      useShell ? "npm.cmd" : "npm",
      ["version", "prerelease", "--preid=dev", "--no-git-tag-version"],
      { useShell }
    );
    // We read the new version to use in the commit and update of the custom file
    const nextDevVersion: any = JSON.parse(
      await readFile(packageJsonPath, "utf-8")
    ).version;
    console.log(`      ✅ Development version updated to: ${nextDevVersion}`);

    // 7.3. Update custom file (ngsw-config.json) with the new version -dev
    console.log(`   [7.3] Updating version on ${customFilePath}...`);
    await updateCustomFileVersion(
      customFilePath,
      customFileVersionPath,
      nextDevVersion
    );

    // 7.4. Commit version changes to develop
    console.log(`   [7.4] Creating a version increment commit in develop...`);
    const bumpCommitMessage: string = `chore(develop): bump version to ${nextDevVersion}`;
    // We add package.json, package-lock.json and the custom file
    await runCommand("git", [
      "add",
      "package.json",
      "package-lock.json",
      customFilePath
    ]);
    await runCommand("git", ["commit", "-m", bumpCommitMessage]);
    console.log(`      ✅ Commit created: ${bumpCommitMessage}`);

    // 7.5. Push develop
    console.log(`   [7.5] Pushing updated develop branch to origin...`);
    await runCommand("git", ["push", "origin", "develop"]);
    console.log(`      ✅ Develop branch pushed.`);

    console.log(`✅ Develop branch prepared for the next cycle.`);
    // --- End of STEP 7 ---

    // Final message of global success
    console.log(
      "\n--- ✅ Complete Production Release Process Successfully Completed ---"
    );
  } catch (error: unknown) {
    // --- Catch Block (handles runCommand errors) ---
    console.error("\n--- ❌ The Production Release Process Failed ---");
    if (error instanceof Error) {
      console.error("Original Error:", error.message);
      if (error.stack) console.error("Stack Trace:", error.stack);
    } else {
      console.error("An unexpected error occurred:", error);
    }
    console.error("\nTrying to clean up and restore the state...");
    try {
      const currentBranchNow: string = await runCommand("git", [
        "rev-parse",
        "--abbrev-ref",
        "HEAD"
      ]);
      if (
        releaseBranch &&
        (currentBranchNow === releaseBranch || currentBranchNow === "develop")
      ) {
        const branchExistsOutput: string = await runCommand("git", [
          "branch",
          "--list",
          releaseBranch
        ]);
        // branchExistsOutput will contain the name of the branch if it exists, or empty if not.
        if (branchExistsOutput.includes(releaseBranch)) {
          console.error(
            `   Trying to delete the release branch ${releaseBranch}...`
          );
          if (currentBranch === "develop" && currentBranchNow !== "develop") {
            await runCommand("git", ["checkout", "develop"]);
          }
          await runCommand("git", ["branch", "-D", releaseBranch]); // Force delete
          console.error(`   Branch ${releaseBranch} deleted locally (forced).`);
        }
      }
      if (currentBranch === "develop" && currentBranchNow !== "develop") {
        console.error(`   Returning to the ${currentBranch} branch...`);
        await runCommand("git", ["checkout", "develop"]);
      }
      console.error("Cleanup attempted. Check the status of the repository.");
    } catch (cleanupError: unknown) {
      console.error("\n   --- ⚠️ Error during cleaning ---");
      if (cleanupError instanceof Error)
        console.error("   Cleaning error:", cleanupError.message);
      else
        console.error(
          "   An unexpected error occurred during cleanup:",
          cleanupError
        );
      console.error("   Manually check the status of the repository.");
    }
    process.exit(1);
  }
}

// Run the script
runProductionRelease();
