import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScanningData } from "./types.js";

export interface TurnInputRecording {
    gameId: string;
    scan: ScanningData;
    diplomacyMessages: unknown[];
    gameEvents: unknown[];
    rootDir?: string | undefined;
    recordedAt?: string;
}

interface RecordingMetadata {
    recordedAt: string;
    gameId: string;
    gameName?: string;
    playerUid: number;
    tick: number;
    tickFragment: number;
    productionCounter: number;
    productionRate: number;
}

export async function recordTurnInputs(recording: TurnInputRecording) {
    const dir = join(recording.rootDir ?? ".", `game-${safePathPart(recording.gameId)}`);
    await mkdir(dir, { recursive: true });

    const metadata = recordingMetadata(recording);
    await appendJsonLine(join(dir, "scandata.jsonl"), {
        ...metadata,
        scan: recording.scan,
    });
    await appendJsonLine(join(dir, "events.jsonl"), {
        ...metadata,
        group: "game_diplomacy",
        count: recording.diplomacyMessages.length,
        records: recording.diplomacyMessages,
    });
    await appendJsonLine(join(dir, "events.jsonl"), {
        ...metadata,
        group: "game_event",
        count: recording.gameEvents.length,
        records: recording.gameEvents,
    });
}

function recordingMetadata(recording: TurnInputRecording): RecordingMetadata {
    return {
        recordedAt: recording.recordedAt ?? new Date().toISOString(),
        gameId: recording.gameId,
        gameName: recording.scan.name,
        playerUid: recording.scan.playerUid,
        tick: recording.scan.tick,
        tickFragment: recording.scan.tickFragment,
        productionCounter: recording.scan.productionCounter,
        productionRate: recording.scan.productionRate,
    };
}

async function appendJsonLine(path: string, value: unknown) {
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

function safePathPart(value: string) {
    return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
