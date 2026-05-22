import { readFile } from "node:fs/promises";
import type { ApiResponse, ScanningData } from "./types.js";
import { createAccountSession, fetchAuthenticatedScan, fetchDiplomacyMessages, fetchGameEvents, fetchScan, shouldSubmitTurnReady, submitCommands, submitDiplomacyDrafts, submitTurnReady, type AccountConfig, type ScanClientConfig } from "./client.js";
import { planTurn, type DecisionRecord, type PlannerConfig } from "./planner.js";
import type { SubmissionResult } from "./command.js";
import { flavorDiplomacyDrafts } from "./diplomacy-style.js";
import { recordTurnInputs } from "./recorder.js";

export interface TurnConfig {
    scan: ScanClientConfig;
    account?: AccountConfig;
    scanFile?: string;
    diplomacyMessages?: unknown[];
    gameEvents?: unknown[];
    gemini?: {
        apiKey: string;
        model: string;
    };
    recordGame?: boolean;
    recordRoot?: string | undefined;
    submit: boolean;
    planner: PlannerConfig;
}

export interface TurnResult {
    decision: DecisionRecord;
    submission: SubmissionResult;
    scan: ScanningData;
}

export async function runTurn(config: TurnConfig): Promise<TurnResult> {
    const accountSession = !config.scanFile && config.account
        ? await createAccountSession(config.account)
        : undefined;
    const scan = config.scanFile
        ? await readScanFile(config.scanFile)
        : await fetchLiveScan(config, accountSession?.cookie);
    const diplomacyMessages = config.diplomacyMessages ?? await readDiplomacyMessages(config, accountSession?.cookie);
    const gameEvents = config.gameEvents ?? await readGameEvents(config, accountSession?.cookie);
    if (config.recordGame && !config.scanFile) {
        await recordTurnInputs({
            gameId: config.scan.gameId,
            scan,
            diplomacyMessages,
            gameEvents,
            rootDir: config.recordRoot,
        });
    }

    const decision = await flavorDiplomacyDrafts(
        planTurn(scan, config.planner, !config.submit, diplomacyMessages, gameEvents),
        config.gemini
            ? {
                ...config.gemini,
                gameId: config.scan.gameId,
            }
            : undefined,
    );
    const submission = config.submit
        ? await submitLive(config, decision, scan, accountSession?.cookie)
        : { submitted: false, responses: [] };

    const result = { decision, submission } as TurnResult;
    Object.defineProperty(result, "scan", {
        value: scan,
        enumerable: false,
    });
    return result;
}

async function readDiplomacyMessages(config: TurnConfig, cookie?: string) {
    if (!config.account || !config.account.gameId) return [];
    return fetchDiplomacyMessages(config.account, cookie);
}

async function readGameEvents(config: TurnConfig, cookie?: string) {
    if (!config.account || !config.account.gameId) return [];
    return fetchGameEvents(config.account, cookie);
}

async function fetchLiveScan(config: TurnConfig, cookie?: string): Promise<ScanningData> {
    if (config.scan.apiKey) {
        return fetchScan(config.scan);
    }
    if (config.account) {
        return fetchAuthenticatedScan({
            ...config.account,
            gameId: config.scan.gameId,
        }, cookie);
    }
    throw new Error("Live scan requires either an API key or account credentials");
}

async function submitLive(config: TurnConfig, decision: DecisionRecord, scan: ScanningData, cookie?: string) {
    if (!config.account) {
        throw new Error("Live submission requires account credentials");
    }
    const commandSubmission = await submitCommands(config.account, decision.commands, cookie);
    const diplomacySubmission = await submitDiplomacyDrafts(config.account, decision.diplomacyDrafts, cookie);
    const readySubmission = shouldSubmitTurnReady(scan)
        ? await submitTurnReady(config.account, cookie)
        : { submitted: false, responses: [] };
    return {
        submitted: commandSubmission.submitted || diplomacySubmission.submitted || readySubmission.submitted,
        responses: [
            ...commandSubmission.responses,
            ...diplomacySubmission.responses,
            ...readySubmission.responses,
        ],
    };
}

async function readScanFile(path: string): Promise<ScanningData> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ApiResponse | { scanning_data?: ScanningData } | ScanningData;
    if ("scanning_data" in parsed && parsed.scanning_data) {
        return parsed.scanning_data;
    }
    return parsed as ScanningData;
}
