import { execSync } from "child_process";
import { readFileSync } from "fs";
import semver from "semver";

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
  run(`npm version ${prodVersion} --no-git-tag-version`);
  run(`git add package.json`);
  run(`git commit -m "release: v${prodVersion}"`);
  run(`git push origin master`);
  run(`npx release-it --config .release-it.master.json --ci`);
}

function releaseDevelop(nextDevVersion) {
  console.log(`🧪 Release en develop: v${nextDevVersion}`);
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`npm version ${nextDevVersion} --no-git-tag-version`);
  run(`git add package.json`);
  run(`git commit -m "chore: bump dev version to ${nextDevVersion}"`);
  run(`git push origin develop`);
  run(`npx release-it --config .release-it.dev.json --ci`);
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

orchestrateRelease(releaseType);
