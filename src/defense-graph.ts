import { estimateStarBattle } from "./battle.js";
import { isEnemyPlayer } from "./relations.js";
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

export type StarDefenseClassification =
    | "interior"
    | "covered"
    | "self_hub"
    | "exposed_high_value"
    | "exposed_low_value";

export interface StarDefenseAnalysis {
    starUid: number;
    starName: string;
    economy: number;
    industry: number;
    science: number;
    ships: number;
    naturalResources: number;
    value: number;
    classification: StarDefenseClassification;
    reason: string;
    closestThreat?: {
        enemyUid: number;
        enemyAlias: string;
        originName: string;
        eta: number;
        reactionTicks: number;
        attackerShips: number;
    };
    defenderCandidates: Array<{
        starUid: number;
        starName: string;
        eta: number;
        ships: number;
    }>;
    assignedHubUid?: number;
    assignedHubName?: string;
}

export interface DefenseGraphPlan {
    turnJumpTicks: number;
    threats: DefenseThreat[];
    hubs: DefenseHubPlan[];
    starAnalyses: StarDefenseAnalysis[];
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

const SELF_HUB_VALUE_THRESHOLD = 20;

export function computeDefenseGraph(scan: ScanningData, ownedStars: ScannedStar[], horizonTicks: number): DefenseGraphPlan {
    const notes: string[] = [];
    const turnJumpTicks = scan.turnBased === 1 ? Math.max(1, scan.config.turnJumpTicks) : 0;
    const threats = computeThreats(scan, ownedStars, Math.max(1, horizonTicks), turnJumpTicks);
    if (threats.length === 0) {
        notes.push("defense graph found no visible enemy origins that can reach owned stars inside the horizon");
    }

    const hubs = selectHubs(scan, ownedStars, threats);
    const starAnalyses = analyzeStars(scan, ownedStars, threats, hubs);
    const coveredTargets = new Set(hubs.flatMap((hub) => hub.coveredTargetUids));
    const threatenedTargets = new Set(threats.map((threat) => threat.targetUid));
    const uncoveredTargetUids = [...threatenedTargets].filter((uid) => !coveredTargets.has(uid));
    const reserveByStarUid = Object.fromEntries(hubs.map((hub) => [hub.hubStarUid, hub.reserveShipsRequired]));

    for (const uid of uncoveredTargetUids) {
        const star = scan.stars[String(uid)];
        if (star) notes.push(`defense graph could not cover ${star.n} after turn-jump reaction timing`);
    }

    return { turnJumpTicks, threats, hubs, starAnalyses, uncoveredTargetUids, reserveByStarUid, notes };
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
            .filter((star): star is ScannedStar => isScanned(star) && star.puid > 0 && isEnemyPlayer(scan, star.puid))
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
            .filter((fleet) => isEnemyPlayer(scan, fleet.puid) && fleet.st > 0 && fleet.ouid > 0 && fleet.o.length === 0)
            .filter((fleet) => scan.stars[String(fleet.ouid)]?.puid !== fleet.puid)
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
    const targetThreats = threatsByTarget(threats);
    const uncovered = new Set(
        [...targetThreats.keys()].filter((uid) => {
            const star = scan.stars[String(uid)];
            if (!star) return false;
            const defenders = defenderCandidates(scan, ownedStars, star, targetThreats.get(uid) ?? []);
            return defenders.some((candidate) => candidate.uid !== uid) || intrinsicStarValue(star) >= SELF_HUB_VALUE_THRESHOLD;
        }),
    );
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
    const targetThreats = threatsByTarget(threats);
    const friendlyEtaByTarget = new Map<number, number>();
    for (const uid of targetThreats.keys()) {
        const target = scan.stars[String(uid)];
        if (!target) continue;
        const distance = starDistance(hub, target);
        const friendlyEta = travelTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
        if (distance <= range) friendlyEtaByTarget.set(uid, friendlyEta);
    }

    const coveredTargetUids = new Set<number>();
    const coveredThreats: DefenseThreat[] = [];
    for (const [uid, entries] of targetThreats.entries()) {
        const friendlyEta = friendlyEtaByTarget.get(uid);
        if (friendlyEta === undefined) continue;
        const minReactionTicks = Math.min(...entries.map((threat) => hub.uid === uid ? Math.max(0, threat.reactionTicks) : threat.reactionTicks));
        if (friendlyEta > minReactionTicks) continue;
        coveredTargetUids.add(uid);
        coveredThreats.push(...entries);
    }
    if (coveredThreats.length === 0) return undefined;

    const externalCoveredTargetUids = [...coveredTargetUids].filter((uid) => uid !== hub.uid);
    const hubValue = intrinsicStarValue(hub);
    if (externalCoveredTargetUids.length === 0 && hubValue < SELF_HUB_VALUE_THRESHOLD) return undefined;

    const reserveShipsRequired = Math.max(0, ...coveredThreats.map((threat) => threat.requiredReinforcement));
    const currentReserveShips = currentFriendlyShipsAt(scan, hub);
    const coverageValue = [...coveredTargetUids]
        .map((uid) => scan.stars[String(uid)])
        .reduce((total, star) => total + (star ? intrinsicStarValue(star) : 0), 0);
    const stagingCost = Math.max(0, reserveShipsRequired - currentReserveShips);
    const externalCoverageValue = externalCoveredTargetUids
        .map((uid) => scan.stars[String(uid)])
        .reduce((total, star) => total + (star ? intrinsicStarValue(star) : 0), 0);
    const score = externalCoveredTargetUids.length * 1000
        + externalCoverageValue * 20
        + hubValue
        + Math.min(currentReserveShips, reserveShipsRequired) * 20
        - stagingCost * 250;
    return { hub, coveredThreats, coveredTargetUids, reserveShipsRequired, currentReserveShips, coverageValue, score };
}

function analyzeStars(scan: ScanningData, ownedStars: ScannedStar[], threats: DefenseThreat[], hubs: DefenseHubPlan[]): StarDefenseAnalysis[] {
    const threatMap = threatsByTarget(threats);
    const assignedHubByTarget = new Map<number, DefenseHubPlan>();
    for (const hub of hubs) {
        for (const uid of hub.coveredTargetUids) {
            assignedHubByTarget.set(uid, hub);
        }
    }

    return ownedStars
        .slice()
        .sort((a, b) => a.uid - b.uid)
        .map((star) => {
            const starThreats = (threatMap.get(star.uid) ?? []).slice().sort((a, b) => a.enemyTravelTicks - b.enemyTravelTicks);
            const closestThreat = starThreats[0];
            const defenders = defenderCandidates(scan, ownedStars, star, starThreats);
            const externalDefenders = defenders.filter((candidate) => candidate.uid !== star.uid);
            const assignedHub = assignedHubByTarget.get(star.uid);
            const value = intrinsicStarValue(star);
            const base = {
                starUid: star.uid,
                starName: star.n,
                economy: star.e,
                industry: star.i,
                science: star.s,
                ships: star.st,
                naturalResources: star.nr,
                value,
                defenderCandidates: defenders.map((candidate) => ({
                    starUid: candidate.uid,
                    starName: candidate.n,
                    eta: travelTicks(starDistance(candidate, star), Math.max(scan.fleetSpeed, 0.0001)),
                    ships: candidate.st,
                })),
            };
            const closest = closestThreat
                ? {
                    enemyUid: closestThreat.enemyUid,
                    enemyAlias: closestThreat.enemyAlias,
                    originName: closestThreat.originName,
                    eta: closestThreat.enemyTravelTicks,
                    reactionTicks: closestThreat.reactionTicks,
                    attackerShips: closestThreat.attackerShips,
                }
                : undefined;

            if (starThreats.length === 0) {
                return compactAnalysis(base, "interior", "can't be attacked inside the planning horizon; interior star", closest, assignedHub);
            }
            if (assignedHub && assignedHub.hubStarUid === star.uid) {
                return compactAnalysis(
                    base,
                    "self_hub",
                    assignedHub.coveredTargetUids.some((uid) => uid !== star.uid)
                        ? `selected as a hub covering ${assignedHub.coveredTargetNames.join(", ")}`
                        : "can't be defended by another star in time; valuable enough to hold as its own hub",
                    closest,
                    assignedHub,
                );
            }
            if (assignedHub) {
                return compactAnalysis(base, "covered", `covered by ${assignedHub.hubStarName}`, closest, assignedHub);
            }
            if (externalDefenders.length > 0) {
                return compactAnalysis(base, "covered", `can be defended from ${externalDefenders.map((candidate) => candidate.n).join(", ")}`, closest, assignedHub);
            }
            if (value >= SELF_HUB_VALUE_THRESHOLD) {
                return compactAnalysis(base, "exposed_high_value", "can't be defended by another star in time; high value and should be its own hub", closest, assignedHub);
            }
            return compactAnalysis(base, "exposed_low_value", "can't be defended by another star in time; low value", closest, assignedHub);
        });
}

function compactAnalysis(
    analysis: Omit<StarDefenseAnalysis, "classification" | "reason" | "closestThreat" | "assignedHubUid" | "assignedHubName">,
    classification: StarDefenseClassification,
    reason: string,
    closestThreat: StarDefenseAnalysis["closestThreat"] | undefined,
    assignedHub: DefenseHubPlan | undefined,
): StarDefenseAnalysis {
    const result: StarDefenseAnalysis = {
        starUid: analysis.starUid,
        starName: analysis.starName,
        economy: analysis.economy,
        industry: analysis.industry,
        science: analysis.science,
        ships: analysis.ships,
        naturalResources: analysis.naturalResources,
        value: analysis.value,
        classification,
        reason,
        defenderCandidates: analysis.defenderCandidates,
    };
    if (closestThreat) result.closestThreat = closestThreat;
    if (assignedHub) {
        result.assignedHubUid = assignedHub.hubStarUid;
        result.assignedHubName = assignedHub.hubStarName;
    }
    return result;
}

function threatsByTarget(threats: DefenseThreat[]) {
    const map = new Map<number, DefenseThreat[]>();
    for (const threat of threats) {
        const entries = map.get(threat.targetUid) ?? [];
        entries.push(threat);
        map.set(threat.targetUid, entries);
    }
    return map;
}

function defenderCandidates(scan: ScanningData, ownedStars: ScannedStar[], target: Star, threats: DefenseThreat[]) {
    if (threats.length === 0) {
        return ownedStars
            .filter((source) => source.uid === target.uid || canReach(scan, source, target))
            .sort((a, b) => travelTicks(starDistance(a, target), Math.max(scan.fleetSpeed, 0.0001)) - travelTicks(starDistance(b, target), Math.max(scan.fleetSpeed, 0.0001)));
    }
    const minReactionTicks = Math.min(...threats.map((threat) => threat.reactionTicks));
    return ownedStars
        .filter((source) => source.uid === target.uid || (canReach(scan, source, target) && travelTicks(starDistance(source, target), Math.max(scan.fleetSpeed, 0.0001)) <= minReactionTicks))
        .sort((a, b) => {
            const aExternal = a.uid === target.uid ? 1 : 0;
            const bExternal = b.uid === target.uid ? 1 : 0;
            return aExternal - bExternal
                || travelTicks(starDistance(a, target), Math.max(scan.fleetSpeed, 0.0001)) - travelTicks(starDistance(b, target), Math.max(scan.fleetSpeed, 0.0001))
                || b.st - a.st
                || b.nr - a.nr
                || a.uid - b.uid;
        });
}

function canReach(scan: ScanningData, source: Star, target: Star) {
    return starDistance(source, target) <= playerRange(scan.players[String(scan.playerUid)]);
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

function weaponsValue(player: Player | undefined) {
    if (!player) return 1;
    return safeNumber((player.tech[String(TECH.WEAPONS)] as TechInfo | undefined)?.level, 1);
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
