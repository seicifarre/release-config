#!/usr/bin/env npx ts-node

import { promisify } from "node:util";
import { execFile as execFileCb, ExecFileOptions } from "node:child_process";
import semver from "semver";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCb); // Promisificamos execFile

// --- Configuración ---
const conventionalPreset: string = "angular";
const customFilePath: string = "ngsw-config.json";
const customFileVersionPath: string = "appData.version"; // Usado para la lógica de actualización JSON
const changelogFile: string = "CHANGELOG.md";
// --- Fin Configuración ---

// --- Función Auxiliar Refactorizada para Ejecutar Comandos ---
async function runCommand(
  command: string, // El comando/ejecutable (ej: 'git', 'npm', 'npx')
  args: string[] = [], // Array de argumentos
  options: ExecFileOptions & { ignoreStderr?: boolean } = {} // Opciones para execFile
): Promise<string> {
  // Logueamos de forma que sea fácil copiar/pegar en terminal si es necesario
  const commandString = `${command} ${args.join(" ")}`;
  console.log(`$ ${commandString}`);
  try {
    const defaultOptions = { encoding: "utf-8", ...options };
    // Usamos execFile
    const { stdout, stderr } = await execFile(command, args, defaultOptions);
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
    // Creamos un error más descriptivo incluyendo el comando que falló
    const wrappedError = new Error(
      `Error executing command "${commandString}":\n${errorOutput}`
    );
    if (error instanceof Error) {
      wrappedError.stack = error.stack; // Preservar stack trace
    }
    throw wrappedError;
  }
}

// Interface para package.json (sin cambios)
interface PackageJson {
  version: string;
  [key: string]: any;
}

// Función Auxiliar para Actualizar Versión en Archivo Personalizado (JSON Parse/Modify - sin cambios)
async function updateCustomFileVersion(
  filePath: string,
  jsonPath: string,
  newVersion: string
): Promise<void> {
  console.log(
    `   🔄 Actualizando versión en ${filePath} (esperada en ${jsonPath}) a ${newVersion} [Método: Parse/Modify]...`
  );
  try {
    const fileContent = await readFile(filePath, "utf-8");
    const jsonObject = JSON.parse(fileContent);
    const keys = jsonPath.split(".");
    let currentLevel = jsonObject;
    for (let i = 0; i < keys.length - 1; i++) {
      if (currentLevel[keys[i]] === undefined)
        throw new Error(`La clave '${keys[i]}' no existe.`);
      currentLevel = currentLevel[keys[i]];
    }
    const finalKey = keys[keys.length - 1];
    if (currentLevel[finalKey] === undefined)
      throw new Error(`La clave final '${finalKey}' no existe.`);
    const oldVersion = currentLevel[finalKey];
    currentLevel[finalKey] = newVersion;
    const updatedJsonContent = JSON.stringify(jsonObject, null, 2);
    await writeFile(filePath, updatedJsonContent, "utf-8");
    console.log(
      `   ✅ Versión actualizada en ${filePath} (de ${oldVersion} a ${newVersion}).`
    );
  } catch (error: any) {
    console.error(
      `   ❌ Error actualizando ${filePath} mediante Parse/Modify:`,
      error.message
    );
    if (error instanceof SyntaxError)
      console.error(
        "   -> Posible problema: El archivo no contiene JSON válido."
      );
    throw new Error(
      `Failed to update version in ${filePath} using Parse/Modify.`
    );
  }
}

// --- Inicio del Script Principal ---
async function runProductionRelease(): Promise<void> {
  let currentBranch = "";
  let releaseBranch = "";
  let nextVersion = "";

  try {
    console.log(
      "--- Iniciando Proceso de Release a Producción (Multiplataforma) ---"
    );

    // === PASO 1: Comprobaciones Previas ===
    console.log("[1/7] Realizando comprobaciones previas...");
    currentBranch = await runCommand("git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
    const status: string = await runCommand("git", ["status", "--porcelain"]);
    if (status)
      throw new Error("❌ Error: El directorio de trabajo no está limpio.");
    if (currentBranch !== "develop")
      throw new Error(
        `❌ Error: Debes estar en 'develop' (rama actual: ${currentBranch}).`
      );
    console.log("    🔄 Actualizando ramas y tags...");
    await runCommand("git", ["pull", "origin", "develop"]);
    await runCommand("git", ["pull", "--ff-only", "origin", "master"]); // Mantenemos --ff-only
    await runCommand("git", ["fetch", "--tags", "origin"], {
      ignoreStderr: true
    });
    console.log("✅ Prerrequisitos cumplidos.");

    // === PASO 2: Determinar Versión de Release desde Develop ===
    console.log("[2/7] Determinando versión de release desde develop...");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
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
        `    ℹ️ Versión actual en develop (package.json): ${currentDevVersion}`
      );
    } catch (error: any) {
      throw new Error(
        `❌ Error: No se pudo leer la versión del package.json local: ${error.message}`
      );
    }
    if (!semver.valid(currentDevVersion))
      throw new Error(
        `❌ Error: Versión ${currentDevVersion} no es SemVer válida.`
      );

    if (semver.prerelease(currentDevVersion)) {
      const hyphenIndex = currentDevVersion.indexOf("-");
      if (hyphenIndex > 0) {
        nextVersion = currentDevVersion.substring(0, hyphenIndex);
        console.log(
          `    ℹ️ Es una pre-release. Versión base extraída: ${nextVersion}`
        );
      } else {
        throw new Error(
          `❌ Error: Pre-release tag detectado pero no se encontró guion en ${currentDevVersion}`
        );
      }
    } else {
      nextVersion = currentDevVersion;
      console.log(
        `    ℹ️ No es una pre-release. Usando versión actual: ${nextVersion}`
      );
    }
    if (!semver.valid(nextVersion))
      throw new Error(
        `❌ Error: Versión final calculada (${nextVersion}) no es SemVer válida.`
      );
    console.log(`✅ Versión para este release de producción: ${nextVersion}`);

    // === PASO 3: Iniciar Git Flow Release ===
    console.log(`[3/7] Iniciando 'git flow release start ${nextVersion}'...`);
    releaseBranch = `release/${nextVersion}`;
    // Usamos 'git' como comando y ['flow', 'release', 'start', version] como argumentos
    await runCommand("git", ["flow", "release", "start", nextVersion]);
    console.log(`✅ Rama ${releaseBranch} creada y activa.`);

    // === PASO 4: Preparar Contenido de la Rama Release ===
    console.log(`[4/7] Preparando contenido de la rama ${releaseBranch}...`);
    // 4.1. Actualizar package.json
    console.log(
      `   [4.1] Actualizando versión en package.json a ${nextVersion}...`
    );
    await runCommand("npm", [
      "version",
      nextVersion,
      "--no-git-tag-version",
      "--allow-same-version"
    ]);
    console.log(`      ✅ package.json y package-lock.json actualizados.`);
    // 4.2. Actualizar archivo personalizado
    console.log(`   [4.2] Actualizando versión en ${customFilePath}...`);
    await updateCustomFileVersion(
      customFilePath,
      customFileVersionPath,
      nextVersion
    );
    // 4.3. Actualizar CHANGELOG.md
    console.log(`   [4.3] Generando/Actualizando ${changelogFile}...`);
    // Usamos npx como comando principal para ejecutar conventional-changelog
    await runCommand("npx", [
      "conventional-changelog",
      "-p",
      conventionalPreset,
      "-i",
      changelogFile,
      "-s",
      "--pkg",
      "./package.json"
    ]);
    console.log(`      ✅ ${changelogFile} actualizado.`);
    // 4.4. Staging
    console.log(`   [4.4] Añadiendo archivos modificados al staging area...`);
    const filesToAdd = [
      "package.json",
      "package-lock.json",
      customFilePath,
      changelogFile
    ];
    await runCommand("git", ["add", ...filesToAdd]);
    console.log(`      ✅ Archivos preparados.`);
    // 4.5. Commit
    console.log(`   [4.5] Creando commit de preparación...`);
    const commitMessage = `chore(release): prepare release v${nextVersion}`;
    await runCommand("git", ["commit", "-m", commitMessage]);
    console.log(`      ✅ Commit creado: ${commitMessage}`);
    console.log(`✅ Contenido de la rama ${releaseBranch} preparado.`);

    // === PASO 5: Finalizar Git Flow Release ===
    console.log(
      `[5/7] Finalizando 'git flow release finish v${nextVersion}'...`
    );
    const mergeMessageContent: string = `Merge release v${nextVersion} into develop`;
    // Pasamos los argumentos como array a 'git'
    await runCommand("git", [
      "flow",
      "release",
      "finish",
      "-m",
      mergeMessageContent,
      "-p",
      nextVersion
    ]); // Pasamos versión SIN 'v'
    console.log(
      `✅ Git flow release finalizado y ramas/tag (v${nextVersion}) empujados a origin.`
    );

    // === PASO 6: Crear Release en GitHub ===
    // El tag ya fue creado y empujado por 'git flow release finish -p' en el paso anterior
    const tagName = `v${nextVersion}`; // Construimos el nombre del tag esperado
    const releaseTitle = `Release ${tagName}`; // Título para la release de GitHub
    console.log(`[6/7] Creando Release en GitHub para el tag ${tagName}...`);

    // Usamos 'gh release create'
    // - tagName: El tag que acabamos de crear y empujar.
    // - --title: El título de la Release en GitHub.
    // - -F o --notes-file: Usa el contenido del CHANGELOG.md como cuerpo de la release.
    // - No usamos --prerelease porque es una release final.
    // - gh CLI usará la autenticación configurada (via gh auth login).
    await runCommand("gh", [
      "release",
      "create",
      tagName,
      "--title",
      releaseTitle,
      "--notes-file",
      changelogFile
    ]);

    console.log(`✅ Release ${releaseTitle} creada en GitHub.`);
    // --- Fin del PASO 6 ---

    // === PASO 7: Actualizar Rama Develop ===
    console.log("[7/7] Preparando la rama develop para el siguiente ciclo...");

    // 7.1. Asegurarse de estar en develop (git flow finish debería dejarnos aquí, pero por seguridad)
    console.log(
      `   [7.1] Verificando y cambiando a develop si es necesario...`
    );
    let finalBranch = await runCommand("git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD"
    ]);
    if (finalBranch !== "develop") {
      console.warn(
        `   ⚠️ No estábamos en develop (estábamos en ${finalBranch}). Cambiando a develop...`
      );
      await runCommand("git", ["checkout", "develop"]);
      // Podríamos hacer un pull extra por si acaso, aunque git flow finish ya hizo merge
      // await runCommand('git', ['pull', 'origin', 'develop']);
    }
    console.log(`      ✅ En rama develop.`);

    // 7.2. Incrementar versión a la siguiente pre-release (-dev.0)
    console.log(
      `   [7.2] Incrementando versión a la siguiente pre-release en package.json...`
    );
    // npm version prerelease incrementa el último número y añade -dev.0
    // o incrementa el .N si ya existe -dev.N
    await runCommand("npm", [
      "version",
      "prerelease",
      "--preid=dev",
      "--no-git-tag-version"
    ]);
    // Leemos la nueva versión para usarla en el commit y la actualización del custom file
    const nextDevVersion = JSON.parse(
      await readFile(packageJsonPath, "utf-8")
    ).version;
    console.log(`      ✅ Versión en develop actualizada a: ${nextDevVersion}`);

    // 7.3. Actualizar archivo personalizado (ngsw-config.json) con la nueva versión -dev
    console.log(`   [7.3] Actualizando versión en ${customFilePath}...`);
    await updateCustomFileVersion(
      customFilePath,
      customFileVersionPath,
      nextDevVersion
    );

    // 7.4. Hacer commit de los cambios de versión en develop
    console.log(
      `   [7.4] Creando commit del incremento de versión en develop...`
    );
    const bumpCommitMessage = `chore(develop): bump version to ${nextDevVersion}`;
    // Añadimos package.json, package-lock.json y el archivo personalizado
    await runCommand("git", [
      "add",
      "package.json",
      "package-lock.json",
      customFilePath
    ]);
    await runCommand("git", ["commit", "-m", bumpCommitMessage]);
    console.log(`      ✅ Commit creado: ${bumpCommitMessage}`);

    // 7.5. Hacer push de develop
    console.log(`   [7.5] Empujando rama develop actualizada a origin...`);
    await runCommand("git", ["push", "origin", "develop"]);
    console.log(`      ✅ Rama develop empujada.`);

    console.log(`✅ Rama develop preparada para el siguiente ciclo.`);
    // --- Fin del PASO 7 ---

    // Mensaje final de éxito global
    console.log(
      "\n--- ✅ Proceso Completo de Release a Producción Finalizado Exitosamente ---"
    );
  } catch (error: unknown) {
    // --- Bloque Catch (Sin cambios, ya maneja errores de runCommand) ---
    console.error("\n--- ❌ Falló el Proceso de Release a Producción ---");
    if (error instanceof Error) {
      console.error("Error Original:", error.message);
      if (error.stack) console.error("Stack Trace:", error.stack);
    } else {
      console.error("Ocurrió un error inesperado:", error);
    }
    console.error("\nIntentando limpiar y restaurar el estado...");
    try {
      const currentBranchNow = await runCommand("git", [
        "rev-parse",
        "--abbrev-ref",
        "HEAD"
      ]);
      if (
        releaseBranch &&
        (currentBranchNow === releaseBranch || currentBranchNow === "develop")
      ) {
        const branchExistsOutput = await runCommand("git", [
          "branch",
          "--list",
          releaseBranch
        ]);
        // branchExistsOutput contendrá el nombre de la rama si existe, o estará vacío si no.
        if (branchExistsOutput.includes(releaseBranch)) {
          console.error(
            `   Intentando borrar la rama de release ${releaseBranch}...`
          );
          if (currentBranch === "develop" && currentBranchNow !== "develop") {
            await runCommand("git", ["checkout", "develop"]);
          }
          await runCommand("git", ["branch", "-D", releaseBranch]); // Forzar borrado
          console.error(
            `   Rama ${releaseBranch} borrada localmente (forzado).`
          );
        }
      }
      if (currentBranch === "develop" && currentBranchNow !== "develop") {
        console.error(`   Volviendo a la rama ${currentBranch}...`);
        await runCommand("git", ["checkout", "develop"]);
      }
      console.error("Limpieza intentada. Revisa el estado del repositorio.");
    } catch (cleanupError: unknown) {
      console.error("\n   --- ⚠️ Error durante la limpieza ---");
      if (cleanupError instanceof Error)
        console.error("   Error de limpieza:", cleanupError.message);
      else
        console.error(
          "   Ocurrió un error inesperado durante la limpieza:",
          cleanupError
        );
      console.error("   Revisa manualmente el estado del repositorio.");
    }
    process.exit(1);
  }
}

// Ejecutar el script
runProductionRelease();
