import { execSync } from "child_process";
import { readFileSync } from "fs";
import semver from "semver";
import "dotenv/config";

function run(cmd) {
  console.log(`🔧 Ejecutando: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
  return pkg.version;
}

function releaseMaster(prodVersion) {
  console.log(`🚀 Release en master: v${prodVersion}`);
  run(`git checkout master`);
  run(`git pull origin master`);

  const current = getCurrentVersion();
  if (current !== prodVersion) {
    run(`npm version ${prodVersion} --no-git-tag-version`);
    run(`git add package.json package-lock.json`);
    run(`git commit -m "release: v${prodVersion}"`);
    run(`git push origin master`);
  } else {
    console.log(
      `⚠️ Ya estás en la versión ${prodVersion}, no se realiza bump.`
    );
  }

  run(`npx release-it --no-npm --config .release-it.master.json --ci`);
}

function releaseDevelop(nextDevVersion) {
  console.log(`🧪 Release en develop: v${nextDevVersion}`);
  run(`git checkout develop`);
  run(`git pull origin develop`);

  const current = getCurrentVersion();
  if (current !== nextDevVersion) {
    run(`npm version ${nextDevVersion} --no-git-tag-version`);
    run(`git add package.json package-lock.json`);
    run(`git commit -m "chore: bump dev version to ${nextDevVersion}"`);
    run(`git push origin develop`);
  } else {
    console.log(
      `⚠️ develop ya tiene la versión ${nextDevVersion}, no se realiza bump.`
    );
  }

  run(`npx release-it --no-npm --config .release-it.dev.json --ci`);
}

function orchestrateRelease(releaseType = "patch") {
  const currentVersionRaw = getCurrentVersion();

  if (!currentVersionRaw.endsWith("-dev")) {
    console.error(
      "❌ La versión actual no contiene '-dev'. Asegúrate de estar en develop."
    );
    process.exit(1);
  }

  const baseVersion = currentVersionRaw.replace("-dev", "");
  const nextDevVersion = semver.inc(baseVersion, releaseType) + "-dev";

  releaseMaster(baseVersion);
  releaseDevelop(nextDevVersion);

  console.log(
    `✅ Release completado: ${baseVersion} (master) → ${nextDevVersion} (develop)`
  );
}

const releaseType = process.argv[2] || "patch";
if (!["patch", "minor", "major"].includes(releaseType)) {
  console.error("❌ Tipo de release no válido. Usa: patch, minor o major");
  process.exit(1);
}

console.log("🔑 GITHUB_TOKEN detected:", process.env.GITHUB_TOKEN ? "Yes ✅" : "No ❌");

orchestrateRelease(releaseType);
