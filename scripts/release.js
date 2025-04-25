import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import semver from "semver";

function run(cmd) {
  console.log(`🔧 Running: ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    env: { ...process.env } // 🔥 Ensures visibility of GITHUB_TOKEN
  });
}

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  return pkg.version;
}

function addFilesToCommit() {
  run(`git add package.json`);
  if (existsSync("package-lock.json")) run(`git add package-lock.json`);
  if (existsSync("CHANGELOG.md")) run(`git add CHANGELOG.md`);
}

function getLastTag(branch) {
  try {
    // Checkout al branch temporalmente (no cambiamos el working copy)
    const currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, {
      encoding: "utf8"
    }).trim();

    // Guardamos dónde estamos
    if (currentBranch !== branch) {
      execSync(`git checkout ${branch}`, { stdio: "ignore" });
    }

    // Ahora en ese branch: obtenemos el último tag
    const tag = execSync(`git describe --tags --abbrev=0`, {
      encoding: "utf8"
    }).trim();

    // Volvemos a donde estábamos
    if (currentBranch !== branch) {
      execSync(`git checkout ${currentBranch}`, { stdio: "ignore" });
    }

    return tag;
  } catch (error) {
    console.warn(
      `⚠️ Failed to get last tag on branch "${branch}": ${error.message}`
    );
    return null;
  }
}

function orchestrateRelease(releaseType = "release") {
  if (!["release", "minor", "major"].includes(releaseType)) {
    console.error("❌ Invalid release type. Use: release, minor, or major.");
    process.exit(1);
  }

  const currentVersionRaw = getCurrentVersion();
  if (!currentVersionRaw.endsWith("-dev")) {
    console.error(
      "❌ The current version does not end with '-dev'. Make sure you are on the develop branch."
    );
    process.exit(1);
  }

  const baseVersion = currentVersionRaw.replace("-dev", "");
  const nextDevVersion = semver.inc(
    baseVersion,
    `pre${releaseType}`,
    "dev",
    false
  );
  const releaseBranch = `release/${baseVersion}`;
  const isWin = process.platform === "win32";

  console.log(
    `🔑 GITHUB_TOKEN detected:`,
    process.env.GITHUB_TOKEN ? "Yes ✅" : "No ❌"
  );

  // 1. Create release branch from develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git checkout -b ${releaseBranch}`);

  // 2. Bump to stable version and generate changelog
  run(`npm version ${baseVersion} --no-git-tag-version`);
  const lastStableTag = getLastTag("master");
  const changelogStable = lastStableTag
    ? isWin
      ? `set CHANGELOG_FROM=${lastStableTag} && node scripts/generate-changelog.js`
      : `CHANGELOG_FROM=${lastStableTag} node scripts/generate-changelog.js`
    : `node scripts/generate-changelog.js`;
  run(changelogStable);
  addFilesToCommit();
  run(`git commit -m "release: v${baseVersion}"`);

  // 3. Merge release into master
  run(`git checkout master`);
  run(`git pull origin master`);
  try {
    run(`git merge --no-ff --no-edit ${releaseBranch}`);
  } catch {
    console.log(
      `⚠️ Conflict detected. Applying files from ${releaseBranch} to resolve.`
    );
    run(`git checkout ${releaseBranch} -- .`);
    run(
      `git commit -am "merge: resolved conflicts in favor of ${releaseBranch}"`
    );
  }
  run(`git push origin master`);

  // ✅ NEW: Ensure clean status before running release-it
  const status = execSync("git status --porcelain").toString().trim();
  if (status) {
    console.warn(
      "⚠️ Warning: Working directory is not clean. Staging and committing remaining changes..."
    );
    run("git add -u");
    run('git commit -m "chore: finalize files before release-it"');
  }

  // 4. Create GitHub release from master
  const runReleaseMaster = isWin
    ? `set RELEASE_VERSION=${baseVersion} && npm run release:master`
    : `RELEASE_VERSION=${baseVersion} npm run release:master`;
  run(runReleaseMaster);

  // 5. Delete release branch
  run(`git branch -d ${releaseBranch}`);

  // 6. Merge master back into develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git merge --no-ff --no-edit master`);
  run(`git push origin develop`);

  // 7. Bump next -dev version
  const current = getCurrentVersion();
  if (current !== nextDevVersion) {
    run(`npm version ${nextDevVersion} --no-git-tag-version`);
    addFilesToCommit();
    run(`git commit -m "chore: bump dev version to ${nextDevVersion}"`);
    run(`git push origin develop`);
  } else {
    console.log(
      `⚠️ Version ${nextDevVersion} already set on develop. Skipping bump.`
    );
  }

  // 8. Generate changelog in develop
  const lastDevTagFinal = getLastTag("develop");
  const changelogDevFinal = lastDevTagFinal
    ? isWin
      ? `set CHANGELOG_FROM=${lastDevTagFinal} && node scripts/generate-changelog.js`
      : `CHANGELOG_FROM=${lastDevTagFinal} node scripts/generate-changelog.js`
    : `node scripts/generate-changelog.js`;
  run(changelogDevFinal);
  run(`git add CHANGELOG.md`);
  run(`git commit -m "docs: update changelog for ${nextDevVersion}"`);
  run(`git push origin develop`);

  // 9. Create pre-release from develop
  const runReleaseDev = isWin
    ? `set RELEASE_VERSION=${nextDevVersion} && npm run release:dev`
    : `RELEASE_VERSION=${nextDevVersion} npm run release:dev`;
  run(runReleaseDev);

  // 10. Final version validation
  const versionAfter = getCurrentVersion();
  if (versionAfter !== nextDevVersion) {
    console.error(
      `❌ ERROR: package.json version mismatch. Expected: ${nextDevVersion}, Found: ${versionAfter}`
    );
    process.exit(1);
  }

  console.log(
    `✅ Release completed: ${baseVersion} (master) → ${nextDevVersion} (develop)`
  );
}

const releaseTypeInput = process.argv[2] || "release";
orchestrateRelease(releaseTypeInput);
