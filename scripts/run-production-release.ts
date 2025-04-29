#!/usr/bin/env npx ts-node

import { promisify } from "node:util";
import { exec as execCb, ExecOptions } from "node:child_process";
import semver from "semver";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const exec = promisify(execCb);

// --- Configuración ---
const conventionalPreset: string = "angular";
const customFilePath: string = "ngsw-config.json";
const customFileVersionPath: string = "appData.version";
const changelogFile: string = "CHANGELOG.md";
// --- Fin Configuración ---

// Función auxiliar para ejecutar comandos (sin cambios)
async function runCommand(
  command: string,
  options: ExecOptions & { ignoreStderr?: boolean } = {}
): Promise<string> {
  console.log(`$ ${command}`);
  try {
    const defaultOptions = { stdio: "pipe", encoding: "utf-8", ...options };
    const { stdout, stderr } = await exec(command, defaultOptions);
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
    // Modificación: Lanzar el error original con más contexto si es posible
    const wrappedError = new Error(
      `Error executing command "${command}":\n${errorOutput}`
    );
    if (error instanceof Error) {
      wrappedError.stack = error.stack; // Preservar stack trace original si existe
    }
    throw wrappedError; // Relanzar para que sea capturado por el catch principal
  }
}

// Interface para package.json (sin cambios)
interface PackageJson {
  version: string;
  [key: string]: any;
}

// --- Función Auxiliar para Actualizar Versión en Archivo Personalizado (NUEVA VERSIÓN) ---
async function updateCustomFileVersion(
  filePath: string,
  jsonPath: string,
  newVersion: string
): Promise<void> {
  // jsonPath ahora solo se usa para el mensaje de log
  console.log(
    `   🔄 Actualizando versión en ${filePath} (esperada en ${jsonPath}) a ${newVersion} [Método: Parse/Modify]...`
  );

  try {
    // 1. Leer el contenido del archivo JSON
    const fileContent = await readFile(filePath, "utf-8");

    // 2. Parsear el JSON a un objeto JavaScript
    const jsonObject = JSON.parse(fileContent);

    // 3. Modificar la propiedad usando el path (asumiendo path simple como 'appData.version')
    //    Necesitamos una forma simple de acceder a la propiedad anidada.
    const keys = jsonPath.split("."); // -> ['appData', 'version']
    let currentLevel = jsonObject;

    // Navegar hasta el penúltimo nivel
    for (let i = 0; i < keys.length - 1; i++) {
      if (currentLevel[keys[i]] === undefined) {
        throw new Error(`La clave '${keys[i]}' no existe en el JSON.`);
      }
      currentLevel = currentLevel[keys[i]];
    }

    // Modificar la propiedad final
    const finalKey = keys[keys.length - 1];
    if (currentLevel[finalKey] === undefined) {
      throw new Error(
        `La clave final '${finalKey}' no existe en el objeto anidado.`
      );
    }
    const oldVersion = currentLevel[finalKey];
    currentLevel[finalKey] = newVersion;

    // 4. Convertir el objeto modificado de vuelta a JSON (con formato)
    //    Usamos null, 2 para mantener una indentación de 2 espacios, similar al original.
    const updatedJsonContent = JSON.stringify(jsonObject, null, 2);

    // 5. Escribir el contenido actualizado de vuelta al archivo
    await writeFile(filePath, updatedJsonContent, "utf-8");

    console.log(
      `   ✅ Versión actualizada en ${filePath} (de ${oldVersion} a ${newVersion}).`
    );
  } catch (error: any) {
    console.error(
      `   ❌ Error actualizando ${filePath} mediante Parse/Modify:`,
      error.message
    );
    // Si el error es de parseo, puede indicar JSON inválido
    if (error instanceof SyntaxError) {
      console.error(
        "   -> Posible problema: El archivo no contiene JSON válido."
      );
    }
    throw new Error(
      `Failed to update version in ${filePath} using Parse/Modify.`
    );
  }
}

// --- Inicio del Script Principal ---
async function runProductionRelease(): Promise<void> {
  let currentBranch = "";
  let releaseBranch = "";
  let nextVersion = ""; // Necesitamos acceso a nextVersion aquí también

  try {
    console.log("--- Iniciando Proceso de Release a Producción ---");

    // === PASO 1: Comprobaciones Previas ===
    console.log("[1/7] Realizando comprobaciones previas...");
    currentBranch = await runCommand("git rev-parse --abbrev-ref HEAD");
    const status: string = await runCommand("git status --porcelain");
    if (status)
      throw new Error(
        "❌ Error: El directorio de trabajo no está limpio. Haz commit o stash."
      );
    if (currentBranch !== "develop")
      throw new Error(
        `❌ Error: Debes estar en la rama 'develop' (rama actual: ${currentBranch}).`
      );
    console.log("    🔄 Actualizando ramas y tags...");
    await runCommand("git pull origin develop");
    await runCommand("git pull --ff-only origin master");
    await runCommand("git fetch --tags origin", { ignoreStderr: true });
    console.log("✅ Prerrequisitos cumplidos.");

    // === PASO 2: Determinar Versión de Release desde Develop ===
    console.log("[2/7] Determinando versión de release desde develop...");

    // Obtenemos la ruta al package.json local
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageJsonPath: string = path.resolve(__dirname, "../package.json");

    // Leemos el package.json actual (estamos en develop)
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

    // Validamos que sea una versión válida (podría ser X.Y.Z o X.Y.Z-dev.N)
    if (!semver.valid(currentDevVersion)) {
      throw new Error(
        `❌ Error: La versión encontrada en package.json (${currentDevVersion}) no es SemVer válida.`
      );
    }

    // Extraemos la parte principal de la versión (quitamos el -dev.N si existe)
    // semver.prerelease('1.0.1-dev.0') devuelve ['dev', 0]
    // semver.prerelease('1.0.1') devuelve null
    if (semver.prerelease(currentDevVersion)) {
      // Si tiene parte de pre-release, la quitamos para obtener la versión base
      nextVersion = `${semver.major(currentDevVersion)}.${semver.minor(
        currentDevVersion
      )}.${semver.patch(currentDevVersion)}`;
      console.log(
        `    ℹ️ Es una pre-release. Versión base extraída: ${nextVersion}`
      );
    } else {
      // Si no tiene parte de pre-release, usamos la versión tal cual
      // Esto podría pasar si se hace un release sin haber corrido pre-releases antes
      nextVersion = currentDevVersion;
      console.log(
        `    ℹ️ No es una pre-release. Usando versión actual: ${nextVersion}`
      );
    }

    // Re-validamos por si acaso la manipulación falló
    if (!semver.valid(nextVersion)) {
      throw new Error(
        `❌ Error: La versión final calculada (${nextVersion}) no es SemVer válida.`
      );
    }

    console.log(`✅ Versión para este release de producción: ${nextVersion}`);
    // --- Fin del PASO 2 Modificado ---

    // === PASO 3: Iniciar Git Flow Release ===
    console.log(`[3/7] Iniciando 'git flow release start ${nextVersion}'...`);
    releaseBranch = `release/${nextVersion}`; // Nombre esperado de la rama
    await runCommand(`git flow release start ${nextVersion}`);
    console.log(`✅ Rama ${releaseBranch} creada y activa.`);

    // === PASO 4: Preparar Contenido de la Rama Release ===
    console.log(`[4/7] Preparando contenido de la rama ${releaseBranch}...`);

    // 4.1. Actualizar package.json (sin crear commit ni tag aquí)
    console.log(
      `   [4.1] Actualizando versión en package.json a ${nextVersion}...`
    );
    // Usamos --allow-same-version por si la versión base ya existía sin -dev
    await runCommand(
      `npm version ${nextVersion} --no-git-tag-version --allow-same-version`
    );
    console.log(`      ✅ package.json y package-lock.json actualizados.`);

    // 4.2. Actualizar archivo personalizado (ngsw-config.json)
    // Necesitas la función updateCustomFileVersion definida en el script
    console.log(
      `   [4.2] Actualizando versión en archivo personalizado (${customFilePath})...`
    );
    await updateCustomFileVersion(
      customFilePath,
      customFileVersionPath,
      nextVersion
    );
    // La función updateCustomFileVersion ya imprime su propio log de éxito/warning

    // 4.3. Actualizar CHANGELOG.md
    console.log(`   [4.3] Generando/Actualizando ${changelogFile}...`);
    // -p usa el preset, -i sobrescribe el mismo archivo, -s añade la entrada para la release actual
    await runCommand(
      `npx conventional-changelog -p ${conventionalPreset} -i ${changelogFile} -s --pkg ./package.json`
    );
    console.log(`      ✅ ${changelogFile} actualizado.`);

    // 4.4. Staging de los cambios
    console.log(`   [4.4] Añadiendo archivos modificados al staging area...`);
    await runCommand(
      `git add package.json package-lock.json ${customFilePath} ${changelogFile}`
    );
    console.log(`      ✅ Archivos preparados.`);

    // 4.5. Crear commit de preparación en la rama release/*
    console.log(`   [4.5] Creando commit de preparación...`);
    const commitMessage = `"chore(release): prepare release v${nextVersion}"`;
    await runCommand(`git commit -m ${commitMessage}`);
    console.log(`      ✅ Commit creado: ${commitMessage}`);

    console.log(`✅ Contenido de la rama ${releaseBranch} preparado.`);
    // --- Fin del PASO 4 ---

    // === PASO 5: Finalizar Git Flow Release ===
    // (Implementaremos esto después)
    console.log("[5/7] Pendiente: Ejecutar git flow release finish...");

    // === PASO 6: Crear Release en GitHub ===
    // (Implementaremos esto después)
    console.log("[6/7] Pendiente: Crear Release en GitHub...");

    // === PASO 7: Actualizar Rama Develop ===
    // (Implementaremos esto al final)
    console.log("[7/7] Pendiente: Actualizar versión en develop...");

    console.log(
      "\n--- 🎉 Release (parcial) completada con éxito (faltan pasos) ---"
    ); // Mensaje temporal
  } catch (error: unknown) {
    // Captura el error original
    console.error("\n--- ❌ Falló el Proceso de Release a Producción ---");

    // === IMPRESIÓN MEJORADA DEL ERROR ORIGINAL ===
    if (error instanceof Error) {
      console.error("Error Original:", error.message);
      console.error("Stack Trace:", error.stack); // Imprime el stack trace
    } else {
      console.error(
        "Ocurrió un error inesperado (no es instancia de Error):",
        error
      );
    }

    // === INTENTO DE LIMPIEZA MÁS SEGURO ===
    console.error("\nIntentando limpiar y restaurar el estado...");
    try {
      // Envuelve la limpieza en su propio try...catch
      const currentBranchNow = await runCommand(
        "git rev-parse --abbrev-ref HEAD"
      );

      // Solo intentar borrar la rama release si existe y estamos en ella o en develop
      if (
        releaseBranch &&
        (currentBranchNow === releaseBranch || currentBranchNow === "develop")
      ) {
        const branchExists = await runCommand(
          `git branch --list ${releaseBranch}`
        );
        if (branchExists) {
          console.error(
            `   Intentando borrar la rama de release ${releaseBranch}...`
          );
          // Cambiar a develop ANTES de borrar la rama release (si no estamos ya)
          if (
            currentBranchNow === releaseBranch &&
            currentBranch === "develop"
          ) {
            await runCommand("git checkout develop");
          }
          // Forzar borrado local (-D). ¡Usar con precaución!
          await runCommand(`git branch -D ${releaseBranch}`);
          console.error(
            `   Rama ${releaseBranch} borrada localmente (forzado).`
          );
        }
      }
      // Asegurarse de volver a la rama original si era develop
      if (currentBranch === "develop" && currentBranchNow !== "develop") {
        console.error(`   Volviendo a la rama ${currentBranch}...`);
        await runCommand(`git checkout ${currentBranch}`);
      }

      console.error("Limpieza intentada. Revisa el estado del repositorio.");
    } catch (cleanupError: unknown) {
      // Captura errores DURANTE la limpieza
      console.error("\n   --- ⚠️ Error durante la limpieza ---");
      if (cleanupError instanceof Error) {
        console.error("   Error de limpieza:", cleanupError.message);
      } else {
        console.error(
          "   Ocurrió un error inesperado durante la limpieza:",
          cleanupError
        );
      }
      console.error(
        "   Revisa manualmente el estado del repositorio (ramas, cambios)."
      );
    }
    process.exit(1); // Salir con error
  }
}

// Ejecutar el script
runProductionRelease();
