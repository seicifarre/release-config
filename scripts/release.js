import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import semver from "semver";

function run(cmd) {
  console.log(`🔧 Ejecutando: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
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

  console.log(
    `🔑 GITHUB_TOKEN detected:`,
    process.env.GITHUB_TOKEN ? "Yes ✅" : "No ❌"
  );

  // 1. Crear release/x.y.z desde develop
  run(`git checkout develop`);
  run(`git pull origin develop`);
  run(`git checkout -b ${releaseBranch}`);

  // 2. Bump versión de producción
  run(`npm version ${baseVersion} --no-git-tag-version`);
  addFilesToCommit();
  run(`git commit -m "release: v${baseVersion}"`);

  // 3. Merge a master
  run(`git checkout master`);
  run(`git pull origin master`);
  run(`git merge --strategy=recursive -X theirs --no-edit ${releaseBranch}`);
  run(`git push origin master`);

  // 4. Release GitHub desde master
  run(
    `npx release-it --no-npm --config .release-it.master.json --ci --increment false --version ${baseVersion}`
  );

  // 5. Borrar la rama release/*
  run(`git branch -d ${releaseBranch}`);

  // 6. Bump siguiente versión -dev en develop
  run(`git checkout develop`);
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

  // 7. Pre-release GitHub desde develop
  run(
    `npx release-it --no-npm --config .release-it.dev.json --ci --increment false --version ${nextDevVersion}`
  );

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
