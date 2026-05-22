import type { Player, ScannedStar, ScanningData, TechInfo } from "./types.js";

const TECH = {
    MANUFACTURING: 2,
    WEAPONS: 5,
} as const;

export interface BattleEstimate {
    attackerUid: number;
    defenderUid: number;
    attackerShips: number;
    defenderShips: number;
    attackerWeapons: number;
    defenderWeapons: number;
    attackerWins: boolean;
    attackerRemaining: number;
    defenderRemaining: number;
    additionalAttackersNeeded: number;
    additionalDefendersNeeded: number;
}

interface Combatants {
    attackerUid: number;
    defenderUid: number;
    attackerShips: number;
    defenderShips: number;
    attackerWeapons: number;
    defenderWeapons: number;
}

export function estimateStarBattle(
    scan: ScanningData,
    attackerUid: number,
    attackerShips: number,
    defenderStar: ScannedStar,
    ticksUntilArrival: number,
    extraDefenderShips = 0,
): BattleEstimate {
    const defenderUid = defenderStar.puid;
    return estimateBattle({
        attackerUid,
        defenderUid,
        attackerShips,
        defenderShips: projectedStarShips(scan, defenderStar, ticksUntilArrival) + extraDefenderShips,
        attackerWeapons: weaponsLevel(scan.players[String(attackerUid)]),
        defenderWeapons: weaponsLevel(scan.players[String(defenderUid)]),
    });
}

export function estimateBattle(combatants: Combatants): BattleEstimate {
    const raw = simulateRaw(combatants);
    return {
        ...combatants,
        ...raw,
        additionalAttackersNeeded: raw.attackerWins ? 0 : minimumAdditionalAttackers(combatants),
        additionalDefendersNeeded: raw.attackerWins ? minimumAdditionalDefenders(combatants) : 0,
    };
}

export function projectedStarShips(scan: ScanningData, star: ScannedStar, ticksUntilArrival: number) {
    const owner = scan.players[String(star.puid)];
    const shipyardProgress = safeNumber(star.yard, 0);
    const shipsPerTick = (star.i * (manufacturingLevel(owner) + 4)) / Math.max(1, scan.productionRate);
    return Math.floor(star.st + shipyardProgress + Math.max(0, ticksUntilArrival) * shipsPerTick);
}

function simulateRaw(combatants: Combatants) {
    let offense = Math.max(0, Math.floor(combatants.attackerShips));
    let defense = Math.max(0, Math.floor(combatants.defenderShips));
    const attackerWeapons = Math.max(1, Math.floor(combatants.attackerWeapons));
    const defenderWeapons = Math.max(1, Math.floor(combatants.defenderWeapons)) + 1;

    while (defense > 0 && offense > 0) {
        offense -= defenderWeapons;
        if (offense <= 0) break;
        defense -= attackerWeapons;
    }

    return {
        attackerWins: offense > 0,
        attackerRemaining: Math.max(0, Math.floor(offense)),
        defenderRemaining: Math.max(0, Math.floor(defense)),
    };
}

function minimumAdditionalAttackers(combatants: Combatants) {
    return minimumAdditional(combatants.attackerShips, (ships) => simulateRaw({ ...combatants, attackerShips: ships }).attackerWins);
}

function minimumAdditionalDefenders(combatants: Combatants) {
    return minimumAdditional(combatants.defenderShips, (ships) => !simulateRaw({ ...combatants, defenderShips: ships }).attackerWins);
}

function minimumAdditional(currentShips: number, predicate: (ships: number) => boolean) {
    const base = Math.max(0, Math.floor(currentShips));
    if (predicate(base)) return 0;

    let high = base + 1;
    while (!predicate(high)) {
        high *= 2;
        if (high > 1000000) return high - base;
    }

    let low = base;
    while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (predicate(mid)) high = mid;
        else low = mid;
    }
    return high - base;
}

function manufacturingLevel(player: Player | undefined) {
    return techLevel(player, TECH.MANUFACTURING);
}

function weaponsLevel(player: Player | undefined) {
    return techLevel(player, TECH.WEAPONS);
}

function techLevel(player: Player | undefined, kind: number) {
    return safeNumber((player?.tech[String(kind)] as TechInfo | undefined)?.level, 1);
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
