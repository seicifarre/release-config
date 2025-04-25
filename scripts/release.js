import "dotenv/config";
import path from "path";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import semver from "semver";

function run(cmd) {
  console.log(`🔧 Ejecutando: ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    env: { ...process.env } // 🔥 Asegura visibilidad de GITHUB_TOKEN
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
      "❌ La versión actual no contiene '-dev'. Asegúrate de estar en develop."
    );
    process.exit(1);
  }

  const baseVersion = currentVersionRaw.replace("-dev", "");
  const nextDevVersion = semver.inc(baseVersion, releaseType) + "-dev";
  const releaseBranch = `release/${baseVersion}`;
  const isWin = process.platform === "win32";

  console.log(
    `🔑 GITHUB_TOKEN detected:`,
    process.env.GITHUB_TOKEN ? "Yes ✅" : "No ❌"
  );

  // 1. Crear release/x.y.z desde develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git checkout -b ${releaseBranch}`);

  // 2. Bump versión estable
  run(`npm version ${baseVersion} --no-git-tag-version`);
  addFilesToCommit();
  run(`git commit -m "release: v${baseVersion}"`);

  // 3. Merge a master con preferencia por release/*
  run(`git checkout master`);
  run(`git pull origin master`);
  try {
    run(`git merge --no-ff ${releaseBranch}`);
  } catch {
    // En caso de conflicto, sobreescribe con archivos de release
    console.log(
      `⚠️ Conflicto detectado. Se aplicarán los archivos de ${releaseBranch} como resolución.`
    );
    run(`git checkout ${releaseBranch} -- .`);
    run(
      `git commit -am "merge: resolved conflicts in favor of ${releaseBranch}"`
    );
  }
  run(`git push origin master`);

  // 4. Crear y subir tag
  const tagName = `v${baseVersion}`;
  run(`git tag ${tagName}`);
  run(`git push origin ${tagName}`);

  // 5. Crear Release GitHub desde master via npm script con RELEASE_VERSION
  const runReleaseMaster = isWin
    ? `set RELEASE_VERSION=${baseVersion} && npm run release:master`
    : `RELEASE_VERSION=${baseVersion} npm run release:master`;
  run(runReleaseMaster);

  // 6. Borrar rama release/*
  run(`git branch -d ${releaseBranch}`);

  // 7. Merge master de vuelta a develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git merge --no-ff master --no-edit`);
  run(`git push origin develop`);

  // 8. Bump siguiente versión -dev
  const current = getCurrentVersion();
  if (current !== nextDevVersion) {
    run(`npm version ${nextDevVersion} --no-git-tag-version`);
    addFilesToCommit();
    run(`git commit -m "chore: bump dev version to ${nextDevVersion}"`);
    run(`git push origin develop`);
  } else {
    console.log(
      `⚠️ develop ya tiene la versión ${nextDevVersion}, no se realiza bump.`
    );
  }

  // 9. Crear y subir tag -dev
  const devTag = `v${nextDevVersion}`;
  run(`git tag ${devTag}`);
  run(`git push origin ${devTag}`);

  // 10. Crear Pre-release desde develop via npm script con RELEASE_VERSION
  const runReleaseDev = isWin
    ? `set RELEASE_VERSION=${nextDevVersion} && npm run release:dev`
    : `RELEASE_VERSION=${nextDevVersion} npm run release:dev`;
  run(runReleaseDev);

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
