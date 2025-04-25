import { execSync } from "child_process";
import process from "process";

const from = process.env.CHANGELOG_FROM;
const to = process.env.CHANGELOG_TO || "HEAD";

if (!from) {
  console.warn(
    "⚠️ No CHANGELOG_FROM defined. The changelog will include all commits from the beginning."
  );
}

// Build the changelog command
const command = from
  ? `npx conventional-changelog -p angular -r 0 --from=${from} --to=${to} -i CHANGELOG.md -s`
  : `npx conventional-changelog -p angular -r 0 --to=${to} -i CHANGELOG.md -s`;

console.log(
  `🛠 Generating changelog ${
    from ? `from ${from}` : "from the beginning"
  } to ${to}...`
);

try {
  execSync(command, { stdio: "inherit" });
  console.log("✅ CHANGELOG.md updated successfully.");
} catch (error) {
  console.error("❌ Failed to generate changelog.");
  console.error(error.message);
  process.exit(1);
}
