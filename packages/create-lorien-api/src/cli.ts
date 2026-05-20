import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { detectPackageManager } from "./detect-package-manager.js";
import { installCommand, runInstall } from "./install.js";
import { scaffold } from "./scaffold.js";
import { validateName } from "./validate-name.js";

interface ParsedArgs {
  name: string | undefined;
  skipInstall: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { name: undefined, skipInstall: false };
  for (const a of argv) {
    if (a === "--skip-install") {
      args.skipInstall = true;
    } else if (!a.startsWith("-") && !args.name) {
      args.name = a;
    }
  }
  return args;
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);

  if (!parsed.name) {
    console.error("Usage: create-lorien <name> [--skip-install]");
    process.exit(1);
  }

  const validation = validateName(parsed.name);
  if (!validation.ok) {
    console.error(
      `Invalid project name '${parsed.name}': ${validation.reason}`,
    );
    process.exit(1);
  }

  const target = resolve(process.cwd(), parsed.name);
  if (await dirIsNonEmpty(target)) {
    console.error(
      `Target directory ${target} already exists and is non-empty. Refusing to overwrite.`,
    );
    process.exit(1);
  }

  const pm = detectPackageManager();

  console.log(
    `Scaffolding '${parsed.name}' at ${target} (package manager: ${pm})…`,
  );
  await scaffold({ target, name: parsed.name, pm });
  console.log(`✓ Files written.`);

  if (parsed.skipInstall) {
    printNextSteps(parsed.name, pm, true);
    return;
  }

  console.log(``);
  console.log(`Running ${pm} install in ${target}…`);
  const result = await runInstall({ target, pm });
  if (result.ok) {
    console.log(`✓ Install complete.`);
    printNextSteps(parsed.name, pm, false);
  } else {
    console.error(``);
    console.error(`✗ Install failed: ${result.error ?? "unknown error"}`);
    console.error(`Your project files are intact at ${target}.`);
    const { cmd, args } = installCommand(pm);
    console.error(
      `Run \`cd ${parsed.name} && ${cmd} ${args.join(" ")}\` manually to retry.`,
    );
    process.exit(1);
  }
}

function printNextSteps(name: string, pm: string, needsInstall: boolean): void {
  const runPrefix = pm === "npm" || pm === "yarn" ? `${pm} run` : pm;
  const execPrefix =
    pm === "pnpm"
      ? "pnpm exec"
      : pm === "yarn"
        ? "yarn"
        : pm === "bun"
          ? "bunx"
          : "npx";
  console.log(``);
  console.log(`✓ Created ${name} with lorien-api`);
  console.log(``);
  console.log(`Next steps:`);
  console.log(`  cd ${name}`);
  if (needsInstall) {
    const { cmd, args } = installCommand(pm as never);
    console.log(`  ${cmd} ${args.join(" ")}`);
  }
  console.log(
    `  ${runPrefix} dev               # start dev server and open the IDE`,
  );
  console.log(`  ${runPrefix} dev:server        # start dev server only`);
  console.log(`  curl localhost:3000/hello`);
  console.log(``);
  console.log(
    `To add a new route, create workflows/<name>.workflow and any nodes`,
  );
  console.log(`it needs under nodes/.`);
  console.log(``);
  console.log(`Tests: ${runPrefix} test`);
  console.log(``);
  console.log(`Docs: https://lorien-api.dev (placeholder)`);
}

async function dirIsNonEmpty(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    if (!s.isDirectory()) return true;
    const entries = await readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
