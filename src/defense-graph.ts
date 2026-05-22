import { estimateStarBattle } from "./battle.js";
import { playerRange, starDistance, travelTicks } from "./star-graph.js";
import { intrinsicStarValue } from "./star-value.js";
import type { Fleet, Player, ScannedStar, ScanningData, Star, TechInfo } from "./types.js";

const TECH = {
    WEAPONS: 5,
} as const;

export interface DefenseThreat {
    enemyUid: number;
    enemyAlias: string;
    originName: string;
    originUid?: number;
    targetUid: number;
    targetName: string;
    enemyTravelTicks: number;
    reactionTicks: number;
    attackerShips: number;
    requiredReinforcement: number;
    attackerWeapons: number;
    defenderWeapons: number;
}

export interface DefenseHubPlan {
    hubStarUid: number;
    hubStarName: string;
    coveredTargetUids: number[];
    coveredTargetNames: string[];
    reserveShipsRequired: number;
    currentReserveShips: number;
    reserveDeficit: number;
    coverageValue: number;
    score: number;
}

export interface DefenseGraphPlan {
    turnJumpTicks: number;
    threats: DefenseThreat[];
    hubs: DefenseHubPlan[];
    uncoveredTargetUids: number[];
    reserveByStarUid: Record<number, number>;
    notes: string[];
}

interface EnemyOrigin {
    enemyUid: number;
    enemyAlias: string;
    name: string;
    uid?: number;
    x: number;
    y: number;
    ships: number;
    speed: number;
}

interface CandidateHub {
    hub: ScannedStar;
    coveredThreats: DefenseThreat[];
    coveredTargetUids: Set<number>;
    reserveShipsRequired: number;
    currentReserveShips: number;
    coverageValue: number;
    score: number;
}

export function computeDefenseGraph(scan: ScanningData, ownedStars: ScannedStar[], horizonTicks: number): DefenseGraphPlan {
    const notes: string[] = [];
    const turnJumpTicks = scan.turnBased === 1 ? Math.max(1, scan.config.turnJumpTicks) : 0;
    const threats = computeThreats(scan, ownedStars, Math.max(1, horizonTicks), turnJumpTicks);
    const meaningfulThreats = threats.filter((threat) => threat.requiredReinforcement > 0);
    if (threats.length === 0) {
        notes.push("defense graph found no visible enemy origins that can reach owned stars inside the horizon");
    }
    if (threats.length > 0 && meaningfulThreats.length === 0) {
        notes.push("defense graph found reachable enemy origins, but current local defenses survive visible single-origin attacks");
    }

    const hubs = selectHubs(scan, ownedStars, meaningfulThreats);
    const coveredTargets = new Set(hubs.flatMap((hub) => hub.coveredTargetUids));
    const threatenedTargets = new Set(meaningfulThreats.map((threat) => threat.targetUid));
    const uncoveredTargetUids = [...threatenedTargets].filter((uid) => !coveredTargets.has(uid));
    const reserveByStarUid = Object.fromEntries(hubs.map((hub) => [hub.hubStarUid, hub.reserveShipsRequired]));

    for (const uid of uncoveredTargetUids) {
        const star = scan.stars[String(uid)];
        if (star) notes.push(`defense graph could not cover ${star.n} after turn-jump reaction timing`);
    }

    return { turnJumpTicks, threats, hubs, uncoveredTargetUids, reserveByStarUid, notes };
}

function computeThreats(scan: ScanningData, ownedStars: ScannedStar[], horizonTicks: number, turnJumpTicks: number): DefenseThreat[] {
    const threats: DefenseThreat[] = [];
    for (const origin of visibleEnemyOrigins(scan)) {
        const player = scan.players[String(origin.enemyUid)];
        const range = playerRange(player);
        for (const target of ownedStars) {
            const distance = starDistance(origin, target);
            const enemyTravelTicks = travelTicks(distance, Math.max(origin.speed, 0.0001));
            if (distance > range || enemyTravelTicks > horizonTicks) continue;
            const estimate = estimateStarBattle(scan, origin.enemyUid, origin.ships, target, enemyTravelTicks, orbitingShipsAt(scan, target.uid, target.puid, enemyTravelTicks));
            const threat: DefenseThreat = {
                enemyUid: origin.enemyUid,
                enemyAlias: origin.enemyAlias,
                originName: origin.name,
                targetUid: target.uid,
                targetName: target.n,
                enemyTravelTicks,
                reactionTicks: enemyTravelTicks - turnJumpTicks,
                attackerShips: origin.ships,
                requiredReinforcement: estimate.additionalDefendersNeeded,
                attackerWeapons: weaponsValue(player),
                defenderWeapons: weaponsValue(scan.players[String(scan.playerUid)]),
            };
            if (origin.uid !== undefined) threat.originUid = origin.uid;
            threats.push(threat);
        }
    }
    return threats.sort((a, b) => b.requiredReinforcement - a.requiredReinforcement
        || intrinsicStarValue(scan.stars[String(b.targetUid)] ?? ({} as Star)) - intrinsicStarValue(scan.stars[String(a.targetUid)] ?? ({} as Star))
        || a.enemyTravelTicks - b.enemyTravelTicks
        || a.targetUid - b.targetUid);
}

function visibleEnemyOrigins(scan: ScanningData): EnemyOrigin[] {
    return [
        ...Object.values(scan.stars)
            .filter((star): star is ScannedStar => isScanned(star) && star.puid > 0 && star.puid !== scan.playerUid && activePlayer(scan, star.puid))
            .map((star) => {
                const orbiting = orbitingShipsAt(scan, star.uid, star.puid, 0);
                return {
                    enemyUid: star.puid,
                    enemyAlias: scan.players[String(star.puid)]?.alias ?? `player ${star.puid}`,
                    name: star.n,
                    uid: star.uid,
                    x: star.x,
                    y: star.y,
                    ships: Math.max(0, star.st + orbiting),
                    speed: scan.fleetSpeed,
                };
            }),
        ...Object.values(scan.fleets)
            .filter((fleet) => fleet.puid !== scan.playerUid && fleet.st > 0 && activePlayer(scan, fleet.puid))
            .map((fleet) => ({
                enemyUid: fleet.puid,
                enemyAlias: scan.players[String(fleet.puid)]?.alias ?? `player ${fleet.puid}`,
                name: `fleet ${fleet.uid}`,
                uid: fleet.uid,
                x: fleet.x,
                y: fleet.y,
                ships: Math.max(0, fleet.st),
                speed: Math.max(fleet.speed || scan.fleetSpeed, 0.0001),
            })),
    ].filter((origin) => origin.ships > 0);
}

function selectHubs(scan: ScanningData, ownedStars: ScannedStar[], threats: DefenseThreat[]): DefenseHubPlan[] {
    const selected: DefenseHubPlan[] = [];
    const uncovered = new Set(threats.map((threat) => threat.targetUid));
    const range = playerRange(scan.players[String(scan.playerUid)]);

    while (uncovered.size > 0) {
        const candidates = ownedStars
            .map((hub) => candidateHub(scan, hub, threats.filter((threat) => uncovered.has(threat.targetUid)), range))
            .filter((candidate): candidate is CandidateHub => candidate !== undefined && candidate.coveredTargetUids.size > 0)
            .sort((a, b) => b.score - a.score
                || b.coveredTargetUids.size - a.coveredTargetUids.size
                || b.coverageValue - a.coverageValue
                || a.hub.uid - b.hub.uid);
        const best = candidates[0];
        if (!best) break;
        selected.push({
            hubStarUid: best.hub.uid,
            hubStarName: best.hub.n,
            coveredTargetUids: [...best.coveredTargetUids],
            coveredTargetNames: [...best.coveredTargetUids].map((uid) => scan.stars[String(uid)]?.n ?? String(uid)),
            reserveShipsRequired: best.reserveShipsRequired,
            currentReserveShips: best.currentReserveShips,
            reserveDeficit: Math.max(0, best.reserveShipsRequired - best.currentReserveShips),
            coverageValue: best.coverageValue,
            score: best.score,
        });
        for (const uid of best.coveredTargetUids) {
            uncovered.delete(uid);
        }
    }

    return selected;
}

function candidateHub(scan: ScanningData, hub: ScannedStar, threats: DefenseThreat[], range: number): CandidateHub | undefined {
    const coveredThreats = threats.filter((threat) => {
        const target = scan.stars[String(threat.targetUid)];
        if (!target) return false;
        const distance = starDistance(hub, target);
        const friendlyEta = travelTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
        const reactionWindow = hub.uid === threat.targetUid ? Math.max(0, threat.reactionTicks) : threat.reactionTicks;
        return distance <= range && friendlyEta <= reactionWindow;
    });
    if (coveredThreats.length === 0) return undefined;

    const coveredTargetUids = new Set(coveredThreats.map((threat) => threat.targetUid));
    const reserveShipsRequired = Math.max(0, ...coveredThreats.map((threat) => threat.requiredReinforcement));
    const currentReserveShips = currentFriendlyShipsAt(scan, hub);
    const coverageValue = [...coveredTargetUids]
        .map((uid) => scan.stars[String(uid)])
        .reduce((total, star) => total + (star ? intrinsicStarValue(star) : 0), 0);
    const stagingCost = Math.max(0, reserveShipsRequired - currentReserveShips);
    const score = coverageValue / Math.max(1, reserveShipsRequired + stagingCost);
    return { hub, coveredThreats, coveredTargetUids, reserveShipsRequired, currentReserveShips, coverageValue, score };
}

function currentFriendlyShipsAt(scan: ScanningData, star: ScannedStar) {
    return Math.max(0, star.st) + orbitingShipsAt(scan, star.uid, scan.playerUid, 0);
}

function orbitingShipsAt(scan: ScanningData, starUid: number, ownerUid: number, ticksUntilArrival: number) {
    return Object.values(scan.fleets)
        .filter((fleet) => fleet.puid === ownerUid && fleet.ouid === starUid)
        .filter((fleet) => fleet.o.length === 0 || safeNumber(fleet.o[0]?.[0], 0) >= ticksUntilArrival)
        .reduce((total, fleet) => total + fleet.st, 0);
}

function isScanned(star: Star): star is ScannedStar {
    return (star as { v: unknown }).v === 1 || (star as { v: unknown }).v === "1";
}

function activePlayer(scan: ScanningData, uid: number) {
    const player = scan.players[String(uid)];
    return player !== undefined && player.totalStars > 0;
}

function weaponsValue(player: Player | undefined) {
    if (!player) return 1;
    return safeNumber((player.tech[String(TECH.WEAPONS)] as TechInfo | undefined)?.level, 1);
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
