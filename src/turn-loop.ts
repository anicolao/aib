#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

interface Args {
    delaySeconds: number;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    process.stdin.setEncoding("utf8");

    while (true) {
        const interrupted = await countdown(args.delaySeconds);
        process.stdout.write(interrupted ? "\nSubmitting turn now.\n" : "\nCountdown complete. Submitting turn.\n");
        await runSubmit();
    }
}

function parseArgs(argv: string[]): Args {
    const args: Args = { delaySeconds: 3600 };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--delay") {
            args.delaySeconds = positiveNumber(requireValue(argv, ++i, arg), arg);
        } else if (arg === "--help") {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return args;
}

async function countdown(delaySeconds: number) {
    process.stdout.write(`Waiting ${delaySeconds}s. Press Enter to submit immediately.\n`);
    return new Promise<boolean>((resolveCountdown) => {
        let remaining = delaySeconds;
        let done = false;

        const finish = (interrupted: boolean) => {
            if (done) return;
            done = true;
            clearInterval(interval);
            process.stdin.off("data", onData);
            resolveCountdown(interrupted);
        };

        const onData = () => finish(true);
        process.stdin.on("data", onData);
        process.stdin.resume();

        renderCountdown(remaining);
        const interval = setInterval(() => {
            remaining -= 1;
            renderCountdown(remaining);
            if (remaining <= 0) finish(false);
        }, 1000);
    });
}

function renderCountdown(remaining: number) {
    const text = `Next submit in ${Math.max(0, remaining)}s. Press Enter to submit now.`;
    if (process.stdout.isTTY) {
        process.stdout.write(`\r${text}   `);
    } else if (remaining % 60 === 0 || remaining <= 10) {
        process.stdout.write(`${text}\n`);
    }
}

async function runSubmit() {
    const cliPath = existsSync(resolve("dist/cli.js"))
        ? resolve("dist/cli.js")
        : resolve("src/cli.ts");
    const command = cliPath.endsWith(".ts")
        ? ["node", ["--no-warnings", "--loader", "ts-node/esm", cliPath, "--submit"]]
        : ["node", [cliPath, "--submit"]];

    const [cmd, args] = command as [string, string[]];
    const child = spawn(cmd, args, {
        stdio: "inherit",
        env: process.env,
    });

    const code = await new Promise<number | null>((resolveCode) => {
        child.on("close", resolveCode);
    });
    if (code !== 0) {
        process.stderr.write(`Submit command exited with code ${code}; continuing loop.\n`);
    }
    await sleep(250);
}

function requireValue(argv: string[], index: number, flag: string) {
    const value = argv[index];
    if (!value) throw new Error(`${flag} requires a value`);
    return value;
}

function positiveNumber(value: string, flag: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a number greater than 0`);
    }
    return Math.floor(parsed);
}

function printHelp() {
    process.stdout.write(`Usage:
  node dist/turn-loop.js [--delay SECONDS]

Options:
  --delay SECONDS   Countdown length before each submit. Defaults to 3600.

Press Enter during the countdown to submit immediately.
`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
