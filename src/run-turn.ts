import { readFile } from "node:fs/promises";
import type { ApiResponse, ScanningData } from "./types.js";
import { fetchAuthenticatedScan, fetchDiplomacyMessages, fetchScan, submitCommands, submitDiplomacyDrafts, type AccountConfig, type ScanClientConfig } from "./client.js";
import { planTurn, type DecisionRecord, type PlannerConfig } from "./planner.js";
import type { SubmissionResult } from "./command.js";
import { flavorDiplomacyDrafts } from "./diplomacy-style.js";

export interface TurnConfig {
    scan: ScanClientConfig;
    account?: AccountConfig;
    scanFile?: string;
    diplomacyMessages?: unknown[];
    gemini?: {
        apiKey: string;
        model: string;
    };
    submit: boolean;
    planner: PlannerConfig;
}

export interface TurnResult {
    decision: DecisionRecord;
    submission: SubmissionResult;
}

export async function runTurn(config: TurnConfig): Promise<TurnResult> {
    const scan = config.scanFile
        ? await readScanFile(config.scanFile)
        : await fetchLiveScan(config);
    const diplomacyMessages = config.diplomacyMessages ?? await readDiplomacyMessages(config);

    const decision = await flavorDiplomacyDrafts(
        planTurn(scan, config.planner, !config.submit, diplomacyMessages),
        config.gemini
            ? {
                ...config.gemini,
                gameId: config.scan.gameId,
            }
            : undefined,
    );
    const submission = config.submit
        ? await submitLive(config, decision)
        : { submitted: false, responses: [] };

    return { decision, submission };
}

async function readDiplomacyMessages(config: TurnConfig) {
    if (!config.account || !config.account.gameId) return [];
    return fetchDiplomacyMessages(config.account);
}

async function fetchLiveScan(config: TurnConfig): Promise<ScanningData> {
    if (config.scan.apiKey) {
        return fetchScan(config.scan);
    }
    if (config.account) {
        return fetchAuthenticatedScan({
            ...config.account,
            gameId: config.scan.gameId,
        });
    }
    throw new Error("Live scan requires either an API key or account credentials");
}

async function submitLive(config: TurnConfig, decision: DecisionRecord) {
    if (!config.account) {
        throw new Error("Live submission requires account credentials");
    }
    const commandSubmission = await submitCommands(config.account, decision.commands);
    const diplomacySubmission = await submitDiplomacyDrafts(config.account, decision.diplomacyDrafts);
    return {
        submitted: commandSubmission.submitted || diplomacySubmission.submitted,
        responses: [
            ...commandSubmission.responses,
            ...diplomacySubmission.responses,
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
