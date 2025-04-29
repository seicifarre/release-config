#!/usr/bin/env npx ts-node

import { promisify } from 'util';
import { exec as execCb, ExecOptions } from 'child_process';
import semver from 'semver';
//import path from 'node:path';
//import { readFile } from 'fs/promises';
//import { fileURLToPath } from 'url';


const exec = promisify(execCb);

// --- Configuración ---
const conventionalPreset: string = 'angular';
//const customFilePath: string = 'ngsw-config.json';
//const customFileVersionPath: string = 'appData.version';
//const changelogFile: string = 'CHANGELOG.md';
// --- Fin Configuración ---

// Función auxiliar para ejecutar comandos (sin cambios)
async function runCommand(command: string, options: ExecOptions & { ignoreStderr?: boolean } = {}): Promise<string> {
    console.log(`$ ${command}`);
    try {
        const defaultOptions = { stdio: 'pipe', encoding: 'utf-8', ...options };
        const { stdout, stderr } = await exec(command, defaultOptions);
        if (stderr && !options.ignoreStderr) {
             if (!stderr.includes('warning:') && !stderr.includes('hint:')) {
                console.error('stderr:', stderr.trim());
             }
        }
        return stdout.trim();
    } catch (error: any) {
        const errorOutput: string = error.stderr || error.stdout || (error instanceof Error ? error.message : String(error));
        // Modificación: Lanzar el error original con más contexto si es posible
        const wrappedError = new Error(`Error executing command "${command}":\n${errorOutput}`);
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

// --- Inicio del Script Principal ---
async function runProductionRelease(): Promise<void> {
    let currentBranch = '';
    let releaseBranch = '';
    let nextVersion = ''; // Necesitamos acceso a nextVersion aquí también

    try {
        console.log('--- Iniciando Proceso de Release a Producción ---');

        // === PASO 1: Comprobaciones Previas ===
        console.log('[1/7] Realizando comprobaciones previas...');
        currentBranch = await runCommand('git rev-parse --abbrev-ref HEAD');
        const status: string = await runCommand('git status --porcelain');
        if (status) throw new Error('❌ Error: El directorio de trabajo no está limpio. Haz commit o stash.');
        if (currentBranch !== 'develop') throw new Error(`❌ Error: Debes estar en la rama 'develop' (rama actual: ${currentBranch}).`);
        console.log('    🔄 Actualizando ramas y tags...');
        await runCommand('git pull origin develop');
        await runCommand('git pull origin master');
        await runCommand('git fetch --tags origin', { ignoreStderr: true });
        console.log('✅ Prerrequisitos cumplidos.');

        // === PASO 2: Determinar Versión Actual y Siguiente ===
        console.log('[2/7] Determinando versiones...');
        let currentVersion: string | null = null;
        try {
            const masterPackageJsonContent: string = await runCommand('git show master:package.json');
            const masterPkg: PackageJson = JSON.parse(masterPackageJsonContent);
            currentVersion = masterPkg.version;
            if (!semver.valid(currentVersion)) throw new Error('Invalid version in master:package.json');
             console.log(`    ℹ️ Versión actual en master: ${currentVersion}`);
        } catch (error) {
             console.log(`    ⚠️ No se pudo obtener la versión de master:package.json. Buscando último tag en master...`);
            const latestMasterTag: string = await runCommand(`git tag --merged master --sort='-v:refname' | grep -E '^v?[0-9]+\\.[0-9]+\\.[0-9]+$' | head -n1`);
            if (!latestMasterTag) throw new Error('❌ Error: No se pudo determinar la versión actual de producción.');
            currentVersion = latestMasterTag.replace(/^v/, '');
            if (!semver.valid(currentVersion)) throw new Error(`❌ Error: Tag ${latestMasterTag} no es SemVer válido.`);
             console.log(`    ℹ️ Versión encontrada en tag de master: ${currentVersion}`);
        }
        if (!currentVersion) throw new Error('❌ Error fatal: No se pudo determinar la versión actual.');

        const bump: string = await runCommand(`npx conventional-recommended-bump -p ${conventionalPreset}`);
        if (!bump || !['major', 'minor', 'patch'].includes(bump)) {
            throw new Error(`❌ Error: No hay commits relevantes para determinar incremento (salida: "${bump}").`);
        }
         console.log(`    ℹ️ Incremento recomendado: ${bump}`);

        // Asignamos a la variable externa para usarla en el catch si es necesario
        nextVersion = semver.inc(currentVersion, bump as 'major' | 'minor' | 'patch')!;
        if (!nextVersion) throw new Error(`❌ Error: No se pudo calcular la siguiente versión.`);
         console.log(`✅ Próxima versión de release: ${nextVersion}`);

        // === PASO 3: Iniciar Git Flow Release ===
        console.log(`[3/7] Iniciando 'git flow release start ${nextVersion}'...`);
        releaseBranch = `release/${nextVersion}`; // Nombre esperado de la rama
        await runCommand(`git flow release start ${nextVersion}`);
         console.log(`✅ Rama ${releaseBranch} creada y activa.`);

        // === PASO 4: Preparar Contenido de la Rama Release ===
        // (Implementaremos esto en el siguiente mensaje)
        console.log('[4/7] Pendiente: Preparar contenido (versión, changelog, commit)...');

        // === PASO 5: Finalizar Git Flow Release ===
        // (Implementaremos esto después)
        console.log('[5/7] Pendiente: Ejecutar git flow release finish...');

        // === PASO 6: Crear Release en GitHub ===
        // (Implementaremos esto después)
        console.log('[6/7] Pendiente: Crear Release en GitHub...');

        // === PASO 7: Actualizar Rama Develop ===
        // (Implementaremos esto al final)
        console.log('[7/7] Pendiente: Actualizar versión en develop...');

        console.log('\n--- 🎉 Release (parcial) completada con éxito (faltan pasos) ---'); // Mensaje temporal

    } catch (error: unknown) { // Captura el error original
        console.error('\n--- ❌ Falló el Proceso de Release a Producción ---');

        // === IMPRESIÓN MEJORADA DEL ERROR ORIGINAL ===
        if (error instanceof Error) {
            console.error('Error Original:', error.message);
            console.error('Stack Trace:', error.stack); // Imprime el stack trace
        } else {
            console.error('Ocurrió un error inesperado (no es instancia de Error):', error);
        }

        // === INTENTO DE LIMPIEZA MÁS SEGURO ===
        console.error('\nIntentando limpiar y restaurar el estado...');
        try { // Envuelve la limpieza en su propio try...catch
            const currentBranchNow = await runCommand('git rev-parse --abbrev-ref HEAD');

            // Solo intentar borrar la rama release si existe y estamos en ella o en develop
            if (releaseBranch && (currentBranchNow === releaseBranch || currentBranchNow === 'develop')) {
                const branchExists = await runCommand(`git branch --list ${releaseBranch}`);
                if (branchExists) {
                    console.error(`   Intentando borrar la rama de release ${releaseBranch}...`);
                    // Cambiar a develop ANTES de borrar la rama release (si no estamos ya)
                    if (currentBranchNow === releaseBranch && currentBranch === 'develop') {
                       await runCommand('git checkout develop');
                    }
                    // Forzar borrado local (-D). ¡Usar con precaución!
                    await runCommand(`git branch -D ${releaseBranch}`);
                    console.error(`   Rama ${releaseBranch} borrada localmente (forzado).`);
                }
            }
             // Asegurarse de volver a la rama original si era develop
             if (currentBranch === 'develop' && currentBranchNow !== 'develop') {
                 console.error(`   Volviendo a la rama ${currentBranch}...`);
                 await runCommand(`git checkout ${currentBranch}`);
             }

            console.error('Limpieza intentada. Revisa el estado del repositorio.');

        } catch (cleanupError: unknown) { // Captura errores DURANTE la limpieza
            console.error('\n   --- ⚠️ Error durante la limpieza ---');
             if (cleanupError instanceof Error) {
                 console.error('   Error de limpieza:', cleanupError.message);
             } else {
                 console.error('   Ocurrió un error inesperado durante la limpieza:', cleanupError);
             }
            console.error('   Revisa manualmente el estado del repositorio (ramas, cambios).');
        }
        process.exit(1); // Salir con error
    }
}

// Ejecutar el script
runProductionRelease();
