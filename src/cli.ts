#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import {
    activeGamesFromReport,
    createAccountSession,
    fetchDiplomacyMessages,
    fetchGameEvents,
    fetchAuthenticatedScan,
    shouldSubmitTurnReady,
    submitCommands,
    submitDiplomacyDrafts,
    submitTurnReady,
    type AccountConfig,
    type AccountGame,
} from "./client.js";
import { runTurn, type TurnConfig } from "./run-turn.js";
import { planTurn } from "./planner.js";
import { flavorDiplomacyDrafts } from "./diplomacy-style.js";

interface CliArgs {
    gameId?: string;
    apiKey?: string;
    baseUrl?: string;
    scanFile?: string;
    submit: boolean;
    markReady: boolean;
    buildCarrier: boolean;
    horizonTicks?: number;
}

async function main() {
    loadDotEnv();
    const args = parseArgs(process.argv.slice(2));
    const baseUrl = args.baseUrl ?? process.env.NP_BASE_URL ?? "https://np4.ironhelmet.com";
    const gameId = args.gameId ?? process.env.NP_GAME_ID ?? process.env.GAME_ID;
    const apiKey = args.apiKey ?? process.env.NP_API_KEY ?? process.env.API_KEY;
    const account = accountConfig(baseUrl, gameId);

    if (!args.scanFile && !gameId && account) {
        await runDiscoveredTurns(account, args, baseUrl);
        return;
    }

    if (!args.scanFile && !gameId) {
        throw new Error("Provide --game, set NP_GAME_ID, use --scan-file, or set NP_USER and NP_PASSWD for account discovery");
    }

    if (!args.scanFile && !apiKey && !account) {
        throw new Error("Live scan requires --key/NP_API_KEY or NP_USER and NP_PASSWD");
    }

    const scan: TurnConfig["scan"] = {
        baseUrl,
        gameId: gameId ?? "scan-file",
    };
    if (apiKey) scan.apiKey = apiKey;

    const config: TurnConfig = {
        scan,
        submit: args.submit,
        planner: {
            horizonTicks: args.horizonTicks ?? numberFromEnv("AIB_HORIZON_TICKS", 30),
            cashReserveRatio: numberFromEnv("AIB_CASH_RESERVE_RATIO", 0.2),
            buildCarrier: args.buildCarrier,
            markReady: args.markReady,
        },
    };
    const gemini = geminiConfig();
    if (gemini) config.gemini = gemini;
    if (account) config.account = account;
    if (args.scanFile) config.scanFile = args.scanFile;

    const result = await runTurn(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function loadDotEnv(path = ".env") {
    if (!existsSync(path)) return;
    const contents = readFileSync(path, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (!match) continue;
        const key = match[1];
        const rawValue = match[2];
        if (!key || rawValue === undefined) continue;
        if (process.env[key] !== undefined) continue;
        process.env[key] = parseDotEnvValue(rawValue.trim());
    }
}

function parseDotEnvValue(value: string) {
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

async function runDiscoveredTurns(account: AccountConfig, args: CliArgs, baseUrl: string) {
    const session = await createAccountSession(account);
    const games = activeGamesFromReport(session.player);
    const results = [];
    for (const game of games) {
        const gameId = accountGameId(game);
        const planner = {
            horizonTicks: args.horizonTicks ?? numberFromEnv("AIB_HORIZON_TICKS", 30),
            cashReserveRatio: numberFromEnv("AIB_CASH_RESERVE_RATIO", 0.2),
            buildCarrier: args.buildCarrier,
            markReady: args.markReady,
        };
        const scan = await fetchAuthenticatedScan({
            ...account,
            baseUrl,
            gameId,
        }, session.cookie);
        const diplomacyMessages = await fetchDiplomacyMessages({
            ...account,
            baseUrl,
            gameId,
        }, session.cookie);
        const gameEvents = await fetchGameEvents({
            ...account,
            baseUrl,
            gameId,
        }, session.cookie);
        const decision = await flavorDiplomacyDrafts(
            planTurn(scan, planner, true, diplomacyMessages, gameEvents),
            geminiConfig(gameId),
        );
        const gameAccount = {
            ...account,
            baseUrl,
            gameId,
        };
        const commandSubmission = args.submit
            ? await submitCommands(gameAccount, decision.commands, session.cookie)
            : { submitted: false, responses: [] };
        const diplomacySubmission = args.submit
            ? await submitDiplomacyDrafts(gameAccount, decision.diplomacyDrafts, session.cookie)
            : { submitted: false, responses: [] };
        const readySubmission = args.submit && shouldSubmitTurnReady(scan)
            ? await submitTurnReady(gameAccount, session.cookie)
            : { submitted: false, responses: [] };
        results.push({
            game: {
                id: gameId,
                name: game.config?.name ?? game.name ?? decision.metadata.gameName,
                status: game.status,
            },
            decision,
            submission: {
                submitted: commandSubmission.submitted || diplomacySubmission.submitted || readySubmission.submitted,
                responses: [
                    ...commandSubmission.responses,
                    ...diplomacySubmission.responses,
                    ...readySubmission.responses,
                ],
            },
        });
    }
    process.stdout.write(`${JSON.stringify({ activeGameCount: games.length, results }, null, 2)}\n`);
}

function geminiConfig(gameId?: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return undefined;
    return {
        apiKey,
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        gameId: gameId ?? process.env.NP_GAME_ID ?? process.env.GAME_ID ?? "scan-file",
    };
}

function accountConfig(baseUrl: string, gameId?: string): AccountConfig | undefined {
    const user = process.env.NP_USER;
    const password = process.env.NP_PASSWD ?? process.env.NP_PASSWORD;
    if (!user || !password) return undefined;
    const config: AccountConfig = {
        baseUrl,
        user,
        password,
        version: process.env.NP_VERSION ?? "np4",
    };
    if (gameId) config.gameId = gameId;
    return config;
}

function accountGameId(game: AccountGame) {
    const id = game.number ?? game.game_number ?? game.id;
    if (id === undefined || id === null || id === "") {
        throw new Error(`Active game did not include an id: ${JSON.stringify(game)}`);
    }
    return String(id);
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        submit: process.env.AIB_SUBMIT === "1",
        markReady: process.env.AIB_MARK_READY === "1",
        buildCarrier: process.env.AIB_BUILD_CARRIER !== "0",
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--game") args.gameId = requireValue(argv, ++i, arg);
        else if (arg === "--key") args.apiKey = requireValue(argv, ++i, arg);
        else if (arg === "--base-url") args.baseUrl = requireValue(argv, ++i, arg);
        else if (arg === "--scan-file") args.scanFile = requireValue(argv, ++i, arg);
        else if (arg === "--submit") args.submit = true;
        else if (arg === "--ready") args.markReady = true;
        else if (arg === "--no-build-carrier") args.buildCarrier = false;
        else if (arg === "--horizon") args.horizonTicks = Number(requireValue(argv, ++i, arg));
        else if (arg === "--help") {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return args;
}

function requireValue(argv: string[], index: number, flag: string) {
    const value = argv[index];
    if (!value) throw new Error(`${flag} requires a value`);
    return value;
}

function numberFromEnv(name: string, fallback: number) {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function printHelp() {
    process.stdout.write(`Usage:
  npx ts-node src/cli.ts --game GAME_ID --key API_KEY
  npx ts-node src/cli.ts --scan-file api.sample.json

Options:
  --submit             Submit orders, diplomacy drafts, and turn-ready after planning. Requires NP_USER and NP_PASSWD.
  --ready              Include force_ready for turn-based games.
  --no-build-carrier   Disable one-carrier build heuristic.
  --horizon TICKS      Planning horizon for optimization. Defaults to 30.
  --base-url URL       Defaults to NP_BASE_URL or https://np4.ironhelmet.com.
`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
