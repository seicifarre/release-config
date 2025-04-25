import { execSync } from "child_process";
import process from "process";

const from = process.env.CHANGELOG_FROM;
const to = process.env.CHANGELOG_TO || "HEAD";

if (!from) {
  console.error("❌ Debes definir la variable CHANGELOG_FROM.");
  process.exit(1);
}

const command = `npx conventional-changelog -p angular -r 0 --from=${from} --to=${to} -i CHANGELOG.md -s`;

console.log(`🔧 Generando changelog desde ${from} hasta ${to}...`);
execSync(command, { stdio: "inherit" });
console.log("✅ Changelog actualizado.");
