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
  if (existsSync("package-lock.json")) {
    run(`git add package-lock.json`);
  }
}

function orchestrateRelease(releaseType = "patch") {
  const currentVersionRaw = getCurrentVersion();

  if (!currentVersionRaw.endsWith("-dev")) {
    console.error(
      "❌ The current version does not contain '-dev'. Make sure you're in develop."
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

  // 1. Create release/x.y.z from develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git checkout -b ${releaseBranch}`);

  // 2. Bump stable version
  run(`npm version ${baseVersion} --no-git-tag-version`);
  addFilesToCommit();
  run(`git commit -m "release: v${baseVersion}"`);

  // 3. Merge to master with preference for release/*
  run(`git checkout master`);
  run(`git pull origin master`);
  try {
    run(`git merge --no-ff --no-edit ${releaseBranch}`);
  } catch {
    // In case of conflict, overwrite with release files
    console.log(
      `⚠️ Conflict detected. The files from ${releaseBranch} will be applied as a resolution.`
    );
    run(`git checkout ${releaseBranch} -- .`);
    run(
      `git commit -am "merge: resolved conflicts in favor of ${releaseBranch}"`
    );
  }
  run(`git push origin master`);

  // 4. Create GitHub Release from master via npm script with RELEASE_VERSION
  const runReleaseMaster = isWin
    ? `set RELEASE_VERSION=${baseVersion} && npm run release:master`
    : `RELEASE_VERSION=${baseVersion} npm run release:master`;
  run(runReleaseMaster);

  // 5. Delete branch release/*
  run(`git branch -d ${releaseBranch}`);

  // 6. Merge master back to develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git merge --no-ff --no-edit master`);
  run(`git push origin develop`);

  // 7. Bump next version -dev
  const current = getCurrentVersion();
  if (current !== nextDevVersion) {
    run(`npm version ${nextDevVersion} --no-git-tag-version`);
    addFilesToCommit();
    run(`git commit -m "chore: bump dev version to ${nextDevVersion}"`);
    run(`git push origin develop`);
  } else {
    console.log(
      `⚠️ develop already has version ${nextDevVersion}, no bump is performed.`
    );
  }

  // 8. Create Pre-release from develop via npm script with RELEASE_VERSION
  const runReleaseDev = isWin
    ? `set RELEASE_VERSION=${nextDevVersion} && npm run release:dev`
    : `RELEASE_VERSION=${nextDevVersion} npm run release:dev`;
  run(runReleaseDev);

  // 9. Validate that package.json retains the correct version -dev
  const versionAfter = getCurrentVersion();
  if (versionAfter !== nextDevVersion) {
    console.error(
      `❌ ERROR: Version in package.json was changed unexpectedly. Expected: ${nextDevVersion}, Current: ${versionAfter}`
    );
    process.exit(1);
  }

  console.log(
    `✅ Release completed: ${currentVersionRaw} (develop) → ${baseVersion} (master) → ${nextDevVersion} (develop)`
  );
}

const releaseType = process.argv[2] || "release";
if (!["release", "minor", "major"].includes(releaseType)) {
  console.error("❌ Invalid release type. Use: release, minor or major");
  process.exit(1);
}

orchestrateRelease(releaseType);
