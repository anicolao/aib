#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
import { collectDiplomacyJudgementCandidates, planTurn, type DecisionRecord } from "./planner.js";
import { flavorDiplomacyDrafts } from "./diplomacy-style.js";
import { recordTurnInputs } from "./recorder.js";
import { writeDebugMap } from "./debug-map.js";
import { postMarkdownToDiscord, postPngToDiscord, type DiscordWebhookConfig } from "./discord-webhook.js";
import type { ScanningData } from "./types.js";

interface CliArgs {
    gameId?: string;
    apiKey?: string;
    baseUrl?: string;
    scanFile?: string;
    submit: boolean;
    markReady: boolean;
    buildCarrier: boolean;
    json: boolean;
    showMap: boolean;
    discord: boolean;
    discordWebhookUrl?: string;
    horizonTicks?: number;
}

async function main() {
    loadDotEnv();
    const args = parseArgs(process.argv.slice(2));
    const baseUrl = args.baseUrl ?? process.env.NP_BASE_URL ?? "https://np4.ironhelmet.com";
    const gameId = args.gameId ?? process.env.NP_GAME_ID ?? process.env.GAME_ID;
    const apiKey = args.apiKey ?? process.env.NP_API_KEY ?? process.env.API_KEY;
    const account = accountConfig(baseUrl, gameId);
    const discord = discordConfig(args);

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
        recordGame: shouldRecordGame(args),
        recordRoot: process.env.AIB_RECORD_DIR,
        planner: {
            horizonTicks: args.horizonTicks ?? numberFromEnv("AIB_HORIZON_TICKS", 60),
            cashReserveRatio: numberFromEnv("AIB_CASH_RESERVE_RATIO", 0),
            buildCarrier: args.buildCarrier,
            markReady: args.markReady,
        },
    };
    const gemini = geminiConfig();
    if (gemini) config.gemini = gemini;
    if (account) config.account = account;
    if (args.scanFile) config.scanFile = args.scanFile;

    const result = await runTurn(config);
    if (args.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
        if (!result.decision) {
            const markdown = renderTurnSummaries([{
                game: { id: gameId ?? "scan-file", name: result.scan.name },
                submission: result.submission,
                scan: result.scan,
                skipped: result.skipped ?? "Skipped.",
            }]);
            printMarkdown(markdown);
            await postDiscordOutputs(markdown, [], discord);
            return;
        }
        const summaries = [{
            game: { id: gameId ?? "scan-file", name: result.decision.metadata.gameName },
            decision: result.decision,
            submission: result.submission,
            scan: result.scan,
        }];
        const markdown = renderTurnSummaries(summaries);
        printMarkdown(markdown);
        const mapPaths = await outputDebugMaps(summaries, args);
        await postDiscordOutputs(markdown, mapPaths, discord);
    }
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
    const discord = discordConfig(args);
    for (const game of games) {
        const gameId = accountGameId(game);
        const planner = {
            horizonTicks: args.horizonTicks ?? numberFromEnv("AIB_HORIZON_TICKS", 60),
            cashReserveRatio: numberFromEnv("AIB_CASH_RESERVE_RATIO", 0),
            buildCarrier: args.buildCarrier,
            markReady: args.markReady,
        };
        const scan = await fetchAuthenticatedScan({
            ...account,
            baseUrl,
            gameId,
        }, session.cookie);
        if (args.submit && alreadyReadyForTurn(scan)) {
            results.push({
                game: {
                    id: gameId,
                    name: game.config?.name ?? game.name ?? scan.name,
                    status: game.status,
                },
                submission: { submitted: false },
                scan,
                skipped: "turn-based game is already submitted",
            });
            continue;
        }
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
        if (shouldRecordGame(args)) {
            await recordTurnInputs({
                gameId,
                scan,
                diplomacyMessages,
                gameEvents,
                rootDir: process.env.AIB_RECORD_DIR,
            });
        }
        const plainDecision = planTurn(scan, planner, true, diplomacyMessages, gameEvents);
        const decision = await flavorDiplomacyDrafts(
            plainDecision,
            geminiConfig(gameId),
            collectDiplomacyJudgementCandidates(scan, diplomacyMessages, plainDecision.diplomacyDrafts, plainDecision.damageTickSolver.selectedResearchKind, plainDecision.summary.cashRemaining),
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
            scan,
        });
    }
    if (args.json) {
        process.stdout.write(`${JSON.stringify({ activeGameCount: games.length, results }, null, 2)}\n`);
    } else {
        const markdown = renderTurnSummaries(results);
        printMarkdown(markdown);
        const mapPaths = await outputDebugMaps(results, args);
        await postDiscordOutputs(markdown, mapPaths, discord);
    }
}

interface TurnSummaryInput {
    game?: {
        id?: string;
        name?: unknown;
        status?: unknown;
    };
    decision?: DecisionRecord;
    submission: {
        submitted: boolean;
    };
    scan?: ScanningData;
    skipped?: string;
}

function renderTurnSummaries(results: TurnSummaryInput[]) {
    if (results.length === 0) {
        return "# AIB Turn Summary\n\nNo active games found.\n";
    }

    return [
        "# AIB Turn Summary",
        "",
        ...results.flatMap((result) => renderTurnSummary(result)),
    ].join("\n");
}

function renderTurnSummary(result: TurnSummaryInput) {
    const decision = result.decision;
    if (!decision) return renderSkippedTurnSummary(result);
    const title = stringValue(result.game?.name) ?? decision.metadata.gameName ?? "Unknown game";
    const gameId = result.game?.id ? ` (${result.game.id})` : "";
    const mode = decision.metadata.dryRun ? "dry run" : "submit";
    const lines = [
        `## ${title}${gameId}`,
        "",
        `Tick ${decision.metadata.tick} | ${mode} | cash $${decision.summary.cashStart} -> $${decision.summary.cashRemaining}`,
        "",
        `Planned ${decision.summary.commandsPlanned} orders, ${decision.summary.diplomacyDraftsPlanned} diplomacy drafts, ${decision.summary.techTransfersPlanned} tech transfers.`,
        "",
        ...renderCommands(decision),
        ...renderDiplomacy(decision),
        ...renderDamageTickSolver(decision),
        ...renderDefenseGraph(decision),
        ...renderCombat(decision),
        ...renderRejected(decision),
        result.submission.submitted ? "**Submitted:** yes" : "**Submitted:** no",
        "",
    ];
    return lines;
}

function renderSkippedTurnSummary(result: TurnSummaryInput) {
    const title = stringValue(result.game?.name) ?? result.scan?.name ?? "Unknown game";
    const gameId = result.game?.id ? ` (${result.game.id})` : "";
    const tick = result.scan ? `Tick ${result.scan.tick}` : "Tick unknown";
    return [
        `## ${title}${gameId}`,
        "",
        `${tick} | skipped`,
        "",
        result.skipped ?? "Skipped.",
        "",
        "**Submitted:** already ready",
        "",
    ];
}

function renderCommands(decision: DecisionRecord) {
    if (decision.commands.length === 0) {
        return ["### Orders", "", "No orders planned.", ""];
    }
    const infrastructure = summarizeInfrastructureOrders(decision);
    const commands = infrastructure.largeSummary
        ? decision.commands.filter((command) => !isInfrastructureOrder(command.order))
        : decision.commands;
    return [
        "### Orders",
        "",
        ...infrastructure.lines,
        ...commands.map((command) => [
            `- \`${command.order}\``,
            `  ${command.reason}`,
            command.followUpReason ? `  Follow-up: ${command.followUpReason}` : undefined,
        ].filter((line): line is string => Boolean(line)).join("\n")),
        "",
    ];
}

function summarizeInfrastructureOrders(decision: DecisionRecord) {
    const orders = decision.commands
        .map((command) => ({ command, match: /^upgrade_(economy|industry|science),(\d+),(\d+)$/.exec(command.order) }))
        .filter((entry): entry is { command: typeof decision.commands[number]; match: RegExpExecArray } => Boolean(entry.match));
    if (orders.length <= 20) return { largeSummary: false, lines: [] };
    const byKind = new Map<string, { count: number; cost: number }>();
    const byStar = new Map<string, { count: number; cost: number }>();
    for (const { command, match } of orders) {
        const kind = match[1] ?? "unknown";
        const starUid = match[2] ?? "unknown";
        const cost = Number(match[3] ?? 0);
        const kindEntry = byKind.get(kind) ?? { count: 0, cost: 0 };
        kindEntry.count += 1;
        kindEntry.cost += cost;
        byKind.set(kind, kindEntry);
        const starName = infrastructureStarName(command.reason) ?? `#${starUid}`;
        const starEntry = byStar.get(starName) ?? { count: 0, cost: 0 };
        starEntry.count += 1;
        starEntry.cost += cost;
        byStar.set(starName, starEntry);
    }
    const totalCost = orders.reduce((sum, entry) => sum + Number(entry.match[3] ?? 0), 0);
    const kindSummary = [...byKind.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([kind, entry]) => `${entry.count} ${kind} ($${entry.cost})`)
        .join(", ");
    const topStars = [...byStar.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 8)
        .map(([star, entry]) => `${star}: ${entry.count} ($${entry.cost})`)
        .join("; ");
    return {
        largeSummary: true,
        lines: [
            `- ${orders.length} infrastructure upgrades, $${totalCost} total: ${kindSummary}.`,
            `  Top stars: ${topStars}.`,
        ],
    };
}

function isInfrastructureOrder(order: string) {
    return /^upgrade_(economy|industry|science),/.test(order);
}

function infrastructureStarName(reason: string) {
    return /^(?:economy|industry|science) at ([^ ]+)/.exec(reason)?.[1];
}

function renderDiplomacy(decision: DecisionRecord) {
    if (decision.diplomacyDrafts.length === 0) {
        return ["### Diplomacy", "", "No diplomacy drafts.", ""];
    }
    return [
        "### Diplomacy",
        "",
        ...decision.diplomacyDrafts.map((draft) => [
            `- ${draft.threadKey ? "Reply" : "New thread"} to **${draft.recipientAlias}**: ${draft.subject}`,
            `  ${draft.reason}`,
            ...(draft.flavorError ? [`  Flavoring failed: ${draft.flavorError}`] : []),
        ].join("\n")),
        "",
    ];
}

function renderDamageTickSolver(decision: DecisionRecord) {
    const solver = decision.damageTickSolver;
    if (!solver) return [];
    const delta = solver.objectiveValue - solver.baselineObjectiveValue;
    const research = solver.research;
    const lines = [
        "### Damage/Tick Solver",
        "",
        `Mode: ${solver.solverMode ?? "legacy"}. Objective ${solver.baselineObjectiveValue.toFixed(2)} -> ${solver.objectiveValue.toFixed(2)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}) over ${solver.horizonTicks} ticks.`,
        `Research: ${techName(research.currentResearchKind)} -> ${techName(research.selectedResearchKind)}; science ${research.currentScience} -> ${research.projectedScience}; Weapons ${research.currentWeapons} -> ${research.projectedWeaponsAtHorizon}.`,
        `Recommendation: ${research.recommendation}.`,
    ];
    if (solver.zones.length > 0) {
        lines.push("");
        lines.push("Top zones:");
        for (const zone of solver.zones.slice(0, 6)) {
            lines.push(`- ${zone.name} (${zone.kind}): D/T ${zone.damagePerTick}, ships/tick ${zone.shipsPerTick}, industry ${zone.reachableIndustry}, WS ${zone.projectedWeapons} vs ${zone.enemyWeapons}, weight ${zone.weight}.`);
        }
    }
    lines.push("");
    return lines;
}

function renderDefenseGraph(decision: DecisionRecord) {
    const graph = decision.defenseGraph;
    if (!graph || (graph.threats.length === 0 && graph.hubs.length === 0)) return [];

    const lines = ["### Defense Graph", ""];
    lines.push(`Turn jump: ${graph.turnJumpTicks} ticks.`);
    for (const threat of graph.threats.slice(0, 8)) {
        lines.push(`- ${threat.enemyAlias} from ${threat.originName} can hit ${threat.targetName}: ETA ${threat.enemyTravelTicks.toFixed(1)}, reaction ${threat.reactionTicks.toFixed(1)}, attackers ${threat.attackerShips} WS ${threat.attackerWeapons}, +${threat.requiredReinforcement} defenders needed.`);
    }
    for (const hub of graph.hubs.slice(0, 6)) {
        lines.push(`- Hub ${hub.hubStarName}: reserve ${hub.currentReserveShips}/${hub.reserveShipsRequired}, covers ${hub.coveredTargetNames.join(", ")}, value ${Math.round(hub.coverageValue)}.`);
    }
    if (graph.uncoveredTargetUids.length > 0) {
        const uncoveredNames = graph.uncoveredTargetUids
            .map((uid) => graph.starAnalyses.find((analysis) => analysis.starUid === uid)?.starName ?? String(uid))
            .map((name) => `[[${name}]]`)
            .join(", ");
        lines.push(`- Uncovered threatened stars: ${uncoveredNames}.`);
    }
    if (graph.starAnalyses.length > 0) {
        lines.push("");
        lines.push("Territory analysis:");
        for (const analysis of graph.starAnalyses) {
            lines.push(`- [[#${decision.metadata.playerUid}]] [[${analysis.starName}]] ${analysis.economy}/${analysis.industry}/${analysis.science} ${analysis.ships} ships -> ${defenseAnalysisSummary(analysis)}.`);
        }
    }
    lines.push("");
    return lines;
}

function techName(kind: number) {
    switch (kind) {
        case 0:
            return "Banking";
        case 1:
            return "Research";
        case 2:
            return "Manufacturing";
        case 3:
            return "Propulsion";
        case 4:
            return "Scanning";
        case 5:
            return "Weapons";
        case 6:
            return "Terraforming";
        default:
            return `tech ${kind}`;
    }
}

function defenseAnalysisSummary(analysis: DecisionRecord["defenseGraph"]["starAnalyses"][number]) {
    const closest = analysis.closestThreat
        ? `closest attacker is [[${analysis.closestThreat.originName}]] with ${analysis.closestThreat.attackerShips} ships, eta ${analysis.closestThreat.eta.toFixed(1)}, reaction ${analysis.closestThreat.reactionTicks.toFixed(1)}`
        : "";
    const defenders = analysis.defenderCandidates
        .filter((candidate) => candidate.starUid !== analysis.starUid)
        .map((candidate) => `[[${candidate.starName}]]`)
        .join(", ");

    if (analysis.classification === "interior") return "can't be attacked; interior star";
    if (analysis.classification === "covered") {
        const hub = analysis.assignedHubName ? `hub [[${analysis.assignedHubName}]]` : "no selected hub";
        return [closest, defenders ? `can be defended from ${defenders}` : "self-defended only", hub].filter(Boolean).join("; ");
    }
    if (analysis.classification === "self_hub") {
        const covered = analysis.reason.startsWith("selected as a hub")
            ? `hub for ${analysis.reason.replace("selected as a hub covering ", "").split(", ").map((name) => `[[${name}]]`).join(", ")}`
            : "hub for itself";
        return [closest, covered].filter(Boolean).join("; ");
    }
    if (analysis.classification === "exposed_high_value") {
        return [closest, "can't be defended; high value and should be its own hub"].filter(Boolean).join("; ");
    }
    return [closest, "can't be defended; low value"].filter(Boolean).join("; ");
}

function renderCombat(decision: DecisionRecord) {
    const attacks = decision.combat.incomingAttacks;
    const planned = [...decision.combat.plannedDefenses, ...decision.combat.plannedAttacks];
    if (attacks.length === 0 && planned.length === 0 && !decision.combat.rally) return [];

    const lines = ["### Combat", ""];
    for (const attack of attacks.slice(0, 8)) {
        const outcome = attack.attackerWins
            ? `attackers win with ${attack.attackerRemaining} remaining; +${attack.additionalDefendersNeeded} defenders needed to survive`
            : `defenders hold with ${attack.defenderRemaining} remaining`;
        lines.push(`- Incoming ${attack.attackerAlias} fleet ${attack.fleetUid} to ${attack.targetName} in ${attack.eta} ticks: attackers ${attack.attackerShips} ships WS ${attack.attackerWeapons}; defenders ${attack.defenderShips} ships WS ${attack.defenderWeapons}; ${outcome}.`);
    }
    for (const route of planned.slice(0, 8)) {
        lines.push(`- Planned carrier ${route.fleetUid} to ${route.targetName}: ${route.reason}`);
    }
    if (decision.combat.rally) {
        lines.push(`- Rally at ${decision.combat.rally.starName}: ${decision.combat.rally.availableShips}/${decision.combat.rally.requiredShips} ships for ${decision.combat.rally.coveredTargetNames.join(", ")}.`);
    }
    lines.push("");
    return lines;
}

function renderRejected(decision: DecisionRecord) {
    const interesting = decision.rejected
        .filter((entry) => /optimizer|carrier budget|staging|incoming|attacking|loses|holds|skipped|blocked|defense graph|reserved idle carrier/i.test(entry))
        .slice(0, 10);
    if (interesting.length === 0) return [];
    return [
        "### Notes",
        "",
        ...interesting.map((entry) => `- ${entry}`),
        "",
    ];
}

function printMarkdown(markdown: string) {
    const glow = spawnSync("glow", ["-"], {
        input: markdown,
        encoding: "utf8",
        stdio: ["pipe", "inherit", "inherit"],
    });
    if (glow.error || glow.status !== 0) {
        process.stdout.write(`${markdown.trimEnd()}\n`);
    }
}

async function postDiscordSummary(markdown: string, config: DiscordWebhookConfig | undefined) {
    if (!config) return;
    process.stdout.write("Discord webhook: posting summary...\n");
    const count = await postMarkdownToDiscord(discordSummaryMarkdown(markdown, config), config, (index, total) => {
        process.stdout.write(`Discord webhook: posting summary message ${index}/${total}...\n`);
    });
    process.stdout.write(`Discord webhook: posted ${count} message${count === 1 ? "" : "s"}.\n`);
}

function discordSummaryMarkdown(markdown: string, config: DiscordWebhookConfig) {
    const name = config.username?.trim();
    if (!name) return markdown;
    return markdown.replace(/^# AIB Turn Summary/m, `# AIB Turn Summary - ${name}`);
}

async function postDiscordMaps(mapPaths: string[], config: DiscordWebhookConfig | undefined) {
    if (!config || mapPaths.length === 0) return;
    process.stdout.write(`Discord webhook: posting ${mapPaths.length} debug map${mapPaths.length === 1 ? "" : "s"}...\n`);
    for (const [index, path] of mapPaths.entries()) {
        process.stdout.write(`Discord webhook: posting debug map ${index + 1}/${mapPaths.length}: ${path}\n`);
        await postPngToDiscord(path, `Debug map: ${path}`, config);
    }
    process.stdout.write(`Discord webhook: posted ${mapPaths.length} debug map${mapPaths.length === 1 ? "" : "s"}.\n`);
}

async function postDiscordOutputs(markdown: string, mapPaths: string[], config: DiscordWebhookConfig | undefined) {
    if (!config) return;
    process.stdout.write("Discord webhook: starting uploads after local output.\n");
    await postDiscordSummary(markdown, config);
    await postDiscordMaps(mapPaths, config);
}

async function outputDebugMaps(results: TurnSummaryInput[], args: CliArgs) {
    const paths: string[] = [];
    if (!args.showMap || args.json) return paths;
    for (const result of results) {
        if (!result.scan || !result.decision) continue;
        const mapOptions = {
            gameId: result.game?.id ?? "scan-file",
        };
        if (process.env.AIB_RECORD_DIR) {
            Object.assign(mapOptions, { rootDir: process.env.AIB_RECORD_DIR });
        }
        const path = await writeDebugMap(result.scan, result.decision, mapOptions);
        paths.push(path);
        process.stdout.write(`\nDebug map: ${path}\n`);
        if (!shouldUseKittyGraphics()) continue;
        const shown = spawnSync("kitty", ["+icat", path], { stdio: "inherit" });
        if (shown.error || shown.status !== 0) {
            process.stdout.write(`kitty +icat failed; open ${path} to inspect the map.\n`);
        }
    }
    return paths;
}

function alreadyReadyForTurn(scan: ScanningData) {
    const player = scan.players[String(scan.playerUid)];
    return scan.turnBased === 1 && player?.ready === 1;
}

function shouldUseKittyGraphics() {
    if (process.env.AIB_SHOW_MAP === "0") return false;
    if (!process.stdout.isTTY) return false;
    return Boolean(process.env.KITTY_WINDOW_ID) || process.env.TERM === "xterm-kitty";
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
        json: process.env.AIB_JSON === "1",
        showMap: process.env.AIB_SHOW_MAP !== "0",
        discord: process.env.AIB_DISCORD_WEBHOOK !== "0",
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
        else if (arg === "--json") args.json = true;
        else if (arg === "--map") args.showMap = true;
        else if (arg === "--no-map") args.showMap = false;
        else if (arg === "--discord-webhook") {
            args.discordWebhookUrl = requireValue(argv, ++i, arg);
            args.discord = true;
        }
        else if (arg === "--no-discord") args.discord = false;
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

function discordConfig(args: CliArgs): DiscordWebhookConfig | undefined {
    if (!args.discord) return undefined;
    const url = args.discordWebhookUrl ?? process.env.AIB_DISCORD_WEBHOOK_URL;
    if (!url) return undefined;
    const config: DiscordWebhookConfig = { url };
    if (process.env.AIB_DISCORD_USERNAME) config.username = process.env.AIB_DISCORD_USERNAME;
    return config;
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

function stringValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
}

function shouldRecordGame(args: CliArgs) {
    return !args.scanFile && process.env.AIB_RECORD_GAME !== "0";
}

function printHelp() {
    process.stdout.write(`Usage:
  npx ts-node src/cli.ts --game GAME_ID --key API_KEY
  npx ts-node src/cli.ts --scan-file api.sample.json

Options:
  --submit             Submit orders, diplomacy drafts, and turn-ready after planning. Requires NP_USER and NP_PASSWD.
  --ready              Include force_ready for turn-based games.
  --no-build-carrier   Disable one-carrier build heuristic.
  --horizon TICKS      Planning horizon for optimization. Defaults to 60.
  --map                Write and display a debug map after the Markdown summary. Default unless AIB_SHOW_MAP=0.
  --no-map             Disable debug map generation.
  --discord-webhook URL
                       Post the full Markdown summary to a Discord webhook.
  --no-discord         Disable Discord webhook posting even if configured.
  --json               Print the full raw JSON result instead of a concise Markdown summary.
  --base-url URL       Defaults to NP_BASE_URL or https://np4.ironhelmet.com.

Environment:
  AIB_RECORD_GAME=0    Disable per-game scan/event recording.
  AIB_RECORD_DIR=PATH  Store game-#### folders under PATH instead of the current directory.
  AIB_SHOW_MAP=0       Disable debug map generation/display.
  AIB_DISCORD_WEBHOOK_URL=URL
                       Post full Markdown summaries to this Discord webhook.
  AIB_DISCORD_WEBHOOK=0
                       Disable Discord webhook posting.
  AIB_DISCORD_USERNAME=NAME
                       Optional displayed webhook username.
`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
