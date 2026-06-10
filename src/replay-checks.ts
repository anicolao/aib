import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planTurn } from "./planner.js";
import type { PlannedCommand } from "./command.js";
import type { ScanningData } from "./types.js";

interface RecordedScan {
    tick: number;
    scan: ScanningData;
}

interface RecordedMessages {
    tick: number;
    group: string;
    records?: Array<{ key?: string }>;
}

const plannerConfig = {
    horizonTicks: 60,
    cashReserveRatio: 0,
    buildCarrier: true,
    markReady: false,
};

runGame7738Checks();

function runGame7738Checks() {
    const infuriumPath = "game-7738";
    const calculumPath = join("..", "aib2", "game-7738");
    if (!existsSync(join(infuriumPath, "scandata.jsonl")) || !existsSync(join(calculumPath, "scandata.jsonl"))) {
        console.log("replay checks: game-7738 histories not found; skipping local replay checks");
        return;
    }

    const infurium60 = planRecordedTurn(infuriumPath, 60);
    assert(!hasOrder(infurium60.commands, "accept_peace,2"), "Infurium should not accept IHG FA after recent attacks");
    assert(infurium60.rejected.some((entry) => /declined formal alliance offer from IHG: they attacked us in the last 30 ticks/.test(entry)));

    const infurium100 = planRecordedTurn(infuriumPath, 100);
    assert(hasOrder(infurium100.commands, "share_tech,1,0"), "Infurium should fulfill Osric's explicit Banking request");
    assert(!hasOrder(infurium100.commands, "send_money,2,75"), "Infurium should not pay IHG after unresolved aggression");

    const infurium120 = planRecordedTurn(infuriumPath, 120);
    assertNoAttacksAgainst(infurium120.commands, infurium120.scan, 3, "Infurium should not attack collaborator Calculum");

    const calculum60 = planRecordedTurn(calculumPath, 60);
    assert(hasOrder(calculum60.commands, "request_peace,4"), "Calculum should request FA with collaborator Infurium");

    const calculum100 = planRecordedTurn(calculumPath, 100);
    assert(calculum100.commands.some((command) => /neutral SteropeII/.test(command.reason)), "Calculum should spend available cash to expand to SteropeII");

    const calculum255 = planRecordedTurn(calculumPath, 255);
    assert(calculum255.commands.some((command) => command.order.startsWith("upgrade_economy,")), "Calculum should value economy near production");

    const calculum260 = planRecordedTurn(calculumPath, 260);
    assertNoAttacksAgainst(calculum260.commands, calculum260.scan, 4, "Calculum should not attack collaborator Infurium");

    console.log("replay checks: game-7738 checks passed");
}

function planRecordedTurn(path: string, tick: number) {
    const record = readScans(path).find((entry) => entry.tick === tick);
    assert(record, `missing scan for ${path} tick ${tick}`);
    const diplomacyMessages = recordsAt(path, tick, "game_diplomacy");
    const gameEvents = recordsAt(path, tick, "game_event");
    const decision = planTurn(record.scan, plannerConfig, true, diplomacyMessages, gameEvents);
    return { ...decision, scan: record.scan };
}

function readScans(path: string) {
    return readJsonl<RecordedScan>(join(path, "scandata.jsonl"));
}

function recordsAt(path: string, tick: number, group: string) {
    const latest = new Map<string, unknown>();
    for (const record of readJsonl<RecordedMessages>(join(path, "events.jsonl"))
        .filter((entry) => entry.tick <= tick && entry.group === group)) {
        for (const event of record.records ?? []) {
            if (event.key) latest.set(event.key, event);
        }
    }
    return [...latest.values()];
}

function readJsonl<T>(path: string) {
    return readFileSync(path, "utf8")
        .trim()
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
}

function hasOrder(commands: PlannedCommand[], prefix: string) {
    return commands.some((command) => command.order.startsWith(prefix));
}

function assertNoAttacksAgainst(commands: PlannedCommand[], scan: ScanningData, playerUid: number, message: string) {
    for (const command of commands) {
        const targetUid = commandTargetUid(command);
        if (targetUid === undefined) continue;
        const target = scan.stars[String(targetUid)];
        if (target?.puid !== playerUid) continue;
        assert(!/\battack\b|offensive|enemy/.test(command.reason), `${message}: ${command.order} ${command.reason}`);
    }
}

function commandTargetUid(command: PlannedCommand) {
    const parts = command.order.split(",");
    if (parts[0] === "add_fleet_orders") return Number(parts[3]);
    return command.followUpTargetUid;
}
