import type { DefenseGraphPlan } from "./defense-graph.js";
import { playerRange, starDistance, travelTicks } from "./star-graph.js";
import { intrinsicStarValue } from "./star-value.js";
import type { GameConfig, Player, ScannedStar, ScanningData, Star, TechInfo } from "./types.js";

const TECH = {
    BANKING: 0,
    RESEARCH: 1,
    MANUFACTURING: 2,
    WEAPONS: 5,
} as const;

export type SolverInfraKind = "economy" | "industry" | "science";

export interface SolverInfraPurchase {
    kind: SolverInfraKind;
    starUid: number;
    starName: string;
    cost: number;
    utility: number;
    score: number;
    reason: string;
}

export interface DamageTickZoneReport {
    name: string;
    starUid: number;
    kind: "defense_hub" | "threatened_star" | "enemy_frontier" | "neutral_frontier" | "owned_frontier";
    weight: number;
    reachableIndustry: number;
    shipsPerTick: number;
    enemyWeapons: number;
    projectedWeapons: number;
    damagePerTick: number;
}

export interface ResearchProjection {
    currentResearchKind: number;
    selectedResearchKind: number;
    currentScience: number;
    projectedScience: number;
    currentWeapons: number;
    projectedWeaponsAtHorizon: number;
    currentResearchCompletionTick?: number;
    selectedResearchCompletionTick?: number;
    recommendation: string;
}

export interface DamageTickSolverPlan {
    purchases: SolverInfraPurchase[];
    cashRemaining: number;
    utility: number;
    objectiveValue: number;
    baselineObjectiveValue: number;
    explored: number;
    pruned: number;
    horizonTicks: number;
    selectedResearchKind: number;
    recommendResearchChange: boolean;
    research: ResearchProjection;
    zones: DamageTickZoneReport[];
    notes: string[];
}

interface SolverOptions {
    horizonTicks: number;
    defenseGraph?: DefenseGraphPlan;
}

interface SolverStar extends ScannedStar {
    frontierWeight?: number;
}

interface Candidate {
    kind: SolverInfraKind;
    starUid: number;
    cost: number;
    immediateUtility: number;
    score: number;
}

interface Zone {
    star: Star;
    kind: DamageTickZoneReport["kind"];
    weight: number;
    enemyWeapons: number;
}

interface ObjectiveResult {
    objectiveValue: number;
    selectedResearchKind: number;
    recommendResearchChange: boolean;
    research: ResearchProjection;
    zones: DamageTickZoneReport[];
}

export function optimizeDamageTickInfrastructure(
    scan: ScanningData,
    player: Player,
    ownedStars: SolverStar[],
    cashStart: number,
    reserve: number,
    options: SolverOptions,
): DamageTickSolverPlan {
    const horizonTicks = Math.max(1, options.horizonTicks);
    const spendable = cashStart - reserve;
    const baselineStars = cloneStars(ownedStars);
    const baseline = evaluateObjective(scan, player, baselineStars, horizonTicks, options.defenseGraph);
    if (spendable <= 0) {
        return emptyPlan(cashStart, baseline, horizonTicks, `no spendable cash after reserve $${reserve}`);
    }

    const maxDepth = Math.min(22, Math.max(5, ownedStars.length * 3));
    const maxNodes = 50000;
    let explored = 0;
    let pruned = 0;
    let bestStars = baselineStars;
    let best: DamageTickSolverPlan = {
        purchases: [],
        cashRemaining: cashStart,
        utility: 0,
        objectiveValue: baseline.objectiveValue,
        baselineObjectiveValue: baseline.objectiveValue,
        explored: 0,
        pruned: 0,
        horizonTicks,
        selectedResearchKind: baseline.selectedResearchKind,
        recommendResearchChange: baseline.recommendResearchChange,
        research: baseline.research,
        zones: baseline.zones,
        notes: [],
    };

    const search = (stateStars: SolverStar[], cash: number, purchases: SolverInfraPurchase[]) => {
        explored += 1;
        const objective = evaluateObjective(scan, player, stateStars, horizonTicks, options.defenseGraph);
        const utility = objective.objectiveValue - baseline.objectiveValue;
        if (utility > best.utility || (utility === best.utility && cash > best.cashRemaining)) {
            bestStars = cloneStars(stateStars);
            best = {
                purchases: [...purchases],
                cashRemaining: cash,
                utility,
                objectiveValue: objective.objectiveValue,
                baselineObjectiveValue: baseline.objectiveValue,
                explored,
                pruned,
                horizonTicks,
                selectedResearchKind: objective.selectedResearchKind,
                recommendResearchChange: objective.recommendResearchChange,
                research: objective.research,
                zones: objective.zones,
                notes: [],
            };
        }
        if (explored >= maxNodes || purchases.length >= maxDepth) return;

        const candidates = rankedCandidates(scan, player, stateStars, cash - reserve, horizonTicks, objective, options.defenseGraph)
            .filter((candidate) => candidate.immediateUtility > -0.5)
            .slice(0, 14);
        if (candidates.length === 0) return;

        const optimistic = utility + candidates.reduce((total, candidate) => total + Math.max(0, candidate.immediateUtility), 0);
        if (optimistic + 0.01 < best.utility) {
            pruned += 1;
            return;
        }

        for (const candidate of candidates) {
            const nextStars = cloneStars(stateStars);
            const nextStar = nextStars.find((star) => star.uid === candidate.starUid);
            if (!nextStar) continue;
            applyPurchase(nextStar, candidate.kind);
            search(nextStars, cash - candidate.cost, [
                ...purchases,
                {
                    kind: candidate.kind,
                    starUid: candidate.starUid,
                    starName: nextStar.n,
                    cost: candidate.cost,
                    utility: candidate.immediateUtility,
                    score: candidate.score,
                    reason: purchaseReason(candidate.kind, nextStar, objective, horizonTicks),
                },
            ]);
        }
    };

    search(baselineStars, cashStart, []);
    const finalObjective = evaluateObjective(scan, player, bestStars, horizonTicks, options.defenseGraph);
    best = {
        ...best,
        explored,
        pruned,
        selectedResearchKind: finalObjective.selectedResearchKind,
        recommendResearchChange: finalObjective.recommendResearchChange,
        research: finalObjective.research,
        zones: finalObjective.zones,
    };
    if (best.purchases.length === 0) {
        best.notes = ["damage/tick solver found no positive infrastructure purchase"];
    }
    return best;
}

function emptyPlan(cashStart: number, baseline: ObjectiveResult, horizonTicks: number, note: string): DamageTickSolverPlan {
    return {
        purchases: [],
        cashRemaining: cashStart,
        utility: 0,
        objectiveValue: baseline.objectiveValue,
        baselineObjectiveValue: baseline.objectiveValue,
        explored: 0,
        pruned: 0,
        horizonTicks,
        selectedResearchKind: baseline.selectedResearchKind,
        recommendResearchChange: baseline.recommendResearchChange,
        research: baseline.research,
        zones: baseline.zones,
        notes: [note],
    };
}

function rankedCandidates(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    spendable: number,
    horizonTicks: number,
    currentObjective: ObjectiveResult,
    defenseGraph: DefenseGraphPlan | undefined,
) {
    if (spendable <= 0) return [];
    const candidates: Candidate[] = [];
    for (const star of stars) {
        const economyCost = economyCostFor(scan.config, star);
        if (economyCost <= spendable && crossesProductionBoundaryNextTurn(scan)) {
            candidates.push(candidateFor(scan, player, stars, star, "economy", economyCost, horizonTicks, currentObjective, defenseGraph));
        }

        const industryCost = industryCostFor(scan.config, star);
        if (industryCost <= spendable) {
            candidates.push(candidateFor(scan, player, stars, star, "industry", industryCost, horizonTicks, currentObjective, defenseGraph));
        }

        const scienceCost = scienceCostFor(scan.config, star);
        if (scienceCost <= spendable && belowEmpireScienceCapAfterPurchase(stars)) {
            candidates.push(candidateFor(scan, player, stars, star, "science", scienceCost, horizonTicks, currentObjective, defenseGraph));
        }
    }
    return candidates
        .filter((candidate) => Number.isFinite(candidate.immediateUtility))
        .sort((a, b) => b.score - a.score || b.immediateUtility - a.immediateUtility || a.cost - b.cost || a.starUid - b.starUid);
}

function candidateFor(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    star: SolverStar,
    kind: SolverInfraKind,
    cost: number,
    horizonTicks: number,
    currentObjective: ObjectiveResult,
    defenseGraph: DefenseGraphPlan | undefined,
): Candidate {
    const nextStars = cloneStars(stars);
    const nextStar = nextStars.find((entry) => entry.uid === star.uid);
    if (nextStar) applyPurchase(nextStar, kind);
    const nextObjective = evaluateObjective(scan, player, nextStars, horizonTicks, defenseGraph);
    const immediateUtility = nextObjective.objectiveValue - currentObjective.objectiveValue;
    return {
        kind,
        starUid: star.uid,
        cost,
        immediateUtility,
        score: immediateUtility / Math.max(1, cost),
    };
}

function evaluateObjective(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    horizonTicks: number,
    defenseGraph: DefenseGraphPlan | undefined,
): ObjectiveResult {
    const zones = buildZones(scan, player, stars, horizonTicks, defenseGraph);
    const currentResearchKind = numeric(player.researching, TECH.WEAPONS);
    const currentResearch = researchProjection(scan, player, stars, zones, horizonTicks, currentResearchKind);
    const weaponsResearch = researchProjection(scan, player, stars, zones, horizonTicks, TECH.WEAPONS);
    const currentCompletionTick = currentResearch.research.currentResearchCompletionTick;
    const currentIsNearlyDone = currentCompletionTick !== undefined && currentCompletionTick <= Math.max(1, Math.min(3, Math.floor(horizonTicks / 10)));
    const selectedResearch = !currentIsNearlyDone && weaponsResearch.objectiveValue >= currentResearch.objectiveValue * 0.98
        ? weaponsResearch
        : currentResearch;
    return {
        objectiveValue: selectedResearch.objectiveValue,
        selectedResearchKind: selectedResearch.research.selectedResearchKind,
        recommendResearchChange: selectedResearch.research.selectedResearchKind !== currentResearchKind,
        research: selectedResearch.research,
        zones: selectedResearch.zones,
    };
}

function researchProjection(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    zones: Zone[],
    horizonTicks: number,
    selectedResearchKind: number,
) {
    const currentResearchKind = numeric(player.researching, selectedResearchKind);
    const currentScience = Math.max(0, numeric(player.totalScience, 0));
    const projectedScience = Math.max(0, stars.reduce((total, star) => total + Math.max(0, star.s), 0));
    const currentWeapons = techLevel(player, TECH.WEAPONS);
    const weapons = player.tech[String(TECH.WEAPONS)] as TechInfo | undefined;
    const currentTech = player.tech[String(currentResearchKind)] as TechInfo | undefined;
    const selectedTech = player.tech[String(selectedResearchKind)] as TechInfo | undefined;
    const currentResearchCompletionTick = completionTick(currentTech, projectedScience);
    const selectedResearchCompletionTick = completionTick(selectedTech, projectedScience);
    const weaponsCompletionTick = selectedResearchKind === TECH.WEAPONS
        ? completionTick(weapons, projectedScience)
        : undefined;
    const weaponSwing = globalWeaponSwing(scan, player, stars, horizonTicks);
    const zonesReport: DamageTickZoneReport[] = [];
    let damageScore = 0;

    for (const zone of zones) {
        const zoneDeadline = Math.max(1, Math.min(horizonTicks, horizonTicks));
        const projectedWeapons = weaponsCompletionTick !== undefined && weaponsCompletionTick <= zoneDeadline
            ? currentWeapons + 1
            : currentWeapons;
        const shipsPerTick = reachableShipsPerTick(scan, player, stars, zone.star, horizonTicks);
        const damagePerTick = damagePerTickFor(shipsPerTick, projectedWeapons, zone.enemyWeapons);
        damageScore += damagePerTick * zone.weight;
        zonesReport.push({
            name: zone.star.n,
            starUid: zone.star.uid,
            kind: zone.kind,
            weight: rounded(zone.weight),
            reachableIndustry: rounded(reachableIndustry(scan, player, stars, zone.star, horizonTicks)),
            shipsPerTick: rounded(shipsPerTick),
            enemyWeapons: zone.enemyWeapons,
            projectedWeapons,
            damagePerTick: rounded(damagePerTick),
        });
    }

    const scienceProgress = selectedResearchKind === TECH.WEAPONS && weapons
        ? researchProgressWithinHorizon(weapons, projectedScience, horizonTicks)
        : 0;
    const scienceMomentum = selectedResearchKind === TECH.WEAPONS && weaponsCompletionTick === undefined
        ? scienceProgress * weaponSwing * 0.35
        : 0;
    const researchCompletionBonus = selectedResearchKind === TECH.WEAPONS && weaponsCompletionTick !== undefined && weaponsCompletionTick <= horizonTicks
        ? weaponSwing * (1 + (horizonTicks - weaponsCompletionTick) / horizonTicks)
        : 0;
    const economyScore = crossesProductionBoundaryNextTurn(scan)
        ? productionEventsWithin(scan, horizonTicks) * projectedEconomy(stars) * 0.8
        : 0;
    const scienceFloorScore = projectedScience * scienceStrategicWeight(scan, player) * 2.2;
    const costProxy = infrastructureCostProxy(scan, stars) * 0.012;
    const objectiveValue = damageScore + scienceMomentum + researchCompletionBonus + economyScore + scienceFloorScore - costProxy;
    const weaponsTiming = weaponsCompletionTick === undefined
        ? `no completion inside a ${horizonTicks}-tick horizon`
        : weaponsCompletionTick <= horizonTicks
            ? `completion at tick +${weaponsCompletionTick} inside a ${horizonTicks}-tick horizon`
            : `completion at tick +${weaponsCompletionTick}, outside the ${horizonTicks}-tick horizon`;
    const recommendation = selectedResearchKind === TECH.WEAPONS
        ? `Weapons focus: level ${currentWeapons} projects to ${weaponsTiming}`
        : `Continue ${techName(selectedResearchKind)}; Weapons completion does not improve damage/tick enough inside ${horizonTicks} ticks`;

    const projection: ResearchProjection = {
        currentResearchKind,
        selectedResearchKind,
        currentScience,
        projectedScience,
        currentWeapons,
        projectedWeaponsAtHorizon: selectedResearchKind === TECH.WEAPONS && weaponsCompletionTick !== undefined && weaponsCompletionTick <= horizonTicks
            ? currentWeapons + 1
            : currentWeapons,
        recommendation,
    };
    if (currentResearchCompletionTick !== undefined) projection.currentResearchCompletionTick = currentResearchCompletionTick;
    if (selectedResearchCompletionTick !== undefined) projection.selectedResearchCompletionTick = selectedResearchCompletionTick;

    return {
        objectiveValue,
        research: projection,
        zones: zonesReport.sort((a, b) => b.weight - a.weight || b.damagePerTick - a.damagePerTick || a.starUid - b.starUid),
    };
}

function buildZones(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    horizonTicks: number,
    defenseGraph: DefenseGraphPlan | undefined,
): Zone[] {
    const zones = new Map<number, Zone>();
    if (defenseGraph) {
        for (const hub of defenseGraph.hubs) {
            const star = scan.stars[String(hub.hubStarUid)];
            if (!star) continue;
            zones.set(star.uid, {
                star,
                kind: "defense_hub",
                weight: Math.max(25, hub.coverageValue) * (1 + Math.max(0, hub.reserveDeficit) / Math.max(10, hub.reserveShipsRequired)),
                enemyWeapons: maxEnemyWeaponsForTargets(scan, hub.coveredTargetUids),
            });
        }
        for (const analysis of defenseGraph.starAnalyses) {
            if (analysis.classification === "interior") continue;
            const star = scan.stars[String(analysis.starUid)];
            if (!star) continue;
            const multiplier = analysis.classification === "exposed_high_value" || analysis.classification === "self_hub" ? 1.25 : 0.75;
            const previous = zones.get(star.uid);
            const weight = Math.max(10, analysis.value) * multiplier;
            if (!previous || previous.weight < weight) {
                zones.set(star.uid, {
                    star,
                    kind: "threatened_star",
                    weight,
                    enemyWeapons: analysis.closestThreat ? techLevel(scan.players[String(analysis.closestThreat.enemyUid)], TECH.WEAPONS) : bestVisibleEnemyWeapons(scan),
                });
            }
        }
    }

    const range = playerRange(player);
    for (const star of Object.values(scan.stars)) {
        if (star.puid === scan.playerUid) continue;
        const nearestOwned = nearestOwnedStar(stars, star);
        if (!nearestOwned) continue;
        const distance = starDistance(nearestOwned, star);
        const eta = travelTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
        if (distance > range || eta > horizonTicks) continue;
        const value = intrinsicStarValue(star);
        if (value <= 0 && star.puid <= 0) continue;
        const kind = star.puid > 0 ? "enemy_frontier" : "neutral_frontier";
        const weight = value * (kind === "enemy_frontier" ? 0.9 : 0.45) / Math.max(1, eta / 5);
        const previous = zones.get(star.uid);
        if (!previous || previous.weight < weight) {
            zones.set(star.uid, {
                star,
                kind,
                weight,
                enemyWeapons: star.puid > 0 ? techLevel(scan.players[String(star.puid)], TECH.WEAPONS) : bestVisibleEnemyWeapons(scan),
            });
        }
    }

    if (zones.size === 0) {
        for (const star of stars
            .slice()
            .sort((a, b) => (b.frontierWeight ?? 1) * intrinsicStarValue(b) - (a.frontierWeight ?? 1) * intrinsicStarValue(a))
            .slice(0, 6)) {
            zones.set(star.uid, {
                star,
                kind: "owned_frontier",
                weight: Math.max(8, intrinsicStarValue(star)) * Math.max(1, star.frontierWeight ?? 1),
                enemyWeapons: bestVisibleEnemyWeapons(scan),
            });
        }
    }

    return [...zones.values()]
        .filter((zone) => zone.weight > 0)
        .sort((a, b) => b.weight - a.weight || a.star.uid - b.star.uid)
        .slice(0, 12);
}

function maxEnemyWeaponsForTargets(scan: ScanningData, targetUids: number[]) {
    const threats = new Set(targetUids);
    let best = bestVisibleEnemyWeapons(scan);
    for (const fleet of Object.values(scan.fleets)) {
        const targetUid = fleet.o[0]?.[1];
        if (fleet.puid !== scan.playerUid && targetUid !== undefined && threats.has(targetUid)) {
            best = Math.max(best, techLevel(scan.players[String(fleet.puid)], TECH.WEAPONS));
        }
    }
    return best;
}

function reachableShipsPerTick(scan: ScanningData, player: Player, stars: SolverStar[], zone: Star, horizonTicks: number) {
    const manufacturing = techLevel(player, TECH.MANUFACTURING);
    const productionRate = Math.max(1, scan.productionRate);
    let total = 0;
    for (const star of stars) {
        const readiness = sourceReadiness(scan, player, star, zone, horizonTicks);
        if (readiness <= 0) continue;
        const production = Math.max(0, star.i) * (manufacturing + 4) / productionRate;
        const stockpile = Math.max(0, star.st) / Math.max(1, horizonTicks) * 0.25;
        total += (production + stockpile) * readiness;
    }
    return total;
}

function reachableIndustry(scan: ScanningData, player: Player, stars: SolverStar[], zone: Star, horizonTicks: number) {
    return stars.reduce((total, star) => total + Math.max(0, star.i) * sourceReadiness(scan, player, star, zone, horizonTicks), 0);
}

function sourceReadiness(scan: ScanningData, player: Player, source: SolverStar, target: Star, horizonTicks: number) {
    if (source.uid === target.uid) return 1;
    const distance = starDistance(source, target);
    if (distance > playerRange(player)) return 0;
    const eta = travelTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
    if (eta > horizonTicks) return 0;
    return Math.max(0.05, (horizonTicks - eta) / horizonTicks);
}

function damagePerTickFor(shipsPerTick: number, ownWeapons: number, enemyWeapons: number) {
    if (shipsPerTick <= 0) return 0;
    return Math.ceil(shipsPerTick / Math.max(1, enemyWeapons + 1)) * Math.max(1, ownWeapons);
}

function globalWeaponSwing(scan: ScanningData, player: Player, stars: SolverStar[], horizonTicks: number) {
    const currentWeapons = techLevel(player, TECH.WEAPONS);
    return buildZones(scan, player, stars, horizonTicks, undefined)
        .reduce((total, zone) => {
            const shipsPerTick = reachableShipsPerTick(scan, player, stars, zone.star, horizonTicks);
            const current = damagePerTickFor(shipsPerTick, currentWeapons, zone.enemyWeapons);
            const next = damagePerTickFor(shipsPerTick, currentWeapons + 1, zone.enemyWeapons);
            return total + (next - current) * zone.weight;
        }, 0);
}

function completionTick(tech: TechInfo | undefined, science: number) {
    if (!tech || science <= 0) return undefined;
    const remaining = Math.max(0, tech.cost - tech.research);
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / science);
}

function researchProgressWithinHorizon(tech: TechInfo, science: number, horizonTicks: number) {
    const remaining = Math.max(1, tech.cost - tech.research);
    return Math.min(1, Math.max(0, science * horizonTicks / remaining));
}

function projectedEconomy(stars: SolverStar[]) {
    return stars.reduce((total, star) => total + Math.max(0, star.e), 0);
}

function belowEmpireScienceCapAfterPurchase(stars: SolverStar[]) {
    const economy = projectedEconomy(stars);
    const science = stars.reduce((total, star) => total + Math.max(0, star.s), 0);
    return science + 1 <= economy / 4;
}

function scienceStrategicWeight(scan: ScanningData, player: Player) {
    const ownWeapons = techLevel(player, TECH.WEAPONS);
    const bestEnemy = bestVisibleEnemyWeapons(scan);
    const behind = Math.max(0, bestEnemy - ownWeapons);
    const researchingWeapons = player.researching === TECH.WEAPONS ? 1.5 : 1;
    return researchingWeapons * (1 + behind * 0.75);
}

function infrastructureCostProxy(scan: ScanningData, stars: SolverStar[]) {
    return stars.reduce((total, star) => {
        const economyCost = economyCostFor(scan.config, star);
        const industryCost = industryCostFor(scan.config, star);
        const scienceCost = scienceCostFor(scan.config, star);
        return total + star.e * economyCost * 0.05 + star.i * industryCost * 0.05 + star.s * scienceCost * 0.05;
    }, 0);
}

function nearestOwnedStar(stars: SolverStar[], target: Star) {
    return stars.reduce<SolverStar | undefined>((best, star) => {
        if (!best) return star;
        return starDistance(star, target) < starDistance(best, target) ? star : best;
    }, undefined);
}

function purchaseReason(kind: SolverInfraKind, star: SolverStar, objective: ObjectiveResult, horizonTicks: number) {
    if (kind === "science") {
        return `${star.n} science improves ${techName(objective.selectedResearchKind)} timing and global Weapons damage/tick over ${horizonTicks} ticks`;
    }
    if (kind === "industry") {
        return `${star.n} industry adds reachable ship production for damage/tick zones`;
    }
    return `${star.n} economy pays out inside the ${horizonTicks}-tick horizon`;
}

function productionEventsWithin(scan: ScanningData, horizonTicks: number) {
    return Math.floor((scan.productionCounter + Math.max(0, horizonTicks)) / Math.max(1, scan.productionRate));
}

function crossesProductionBoundaryNextTurn(scan: ScanningData) {
    const nextTurnTicks = scan.turnBased === 1
        ? Math.max(1, scan.config.turnJumpTicks)
        : 1;
    return scan.productionCounter + nextTurnTicks >= scan.productionRate;
}

function applyPurchase(star: SolverStar, kind: SolverInfraKind) {
    if (kind === "economy") star.e += 1;
    if (kind === "industry") star.i += 1;
    if (kind === "science") star.s += 1;
}

function cloneStars(stars: SolverStar[]) {
    return stars.map((star) => ({ ...star }));
}

function economyCostFor(config: GameConfig, star: ScannedStar) {
    return Math.floor((2.5 * (star.e + 1) * config.devCostEco) / Math.max(0.01, star.r / 100));
}

function industryCostFor(config: GameConfig, star: ScannedStar) {
    return Math.floor((5 * (star.i + 1) * config.devCostInd) / Math.max(0.01, star.r / 100));
}

function scienceCostFor(config: GameConfig, star: ScannedStar) {
    return Math.floor((20 * (star.s + 1) * config.devCostSci) / Math.max(0.01, star.r / 100));
}

function bestVisibleEnemyWeapons(scan: ScanningData) {
    return Object.values(scan.players)
        .filter((player) => player.uid !== scan.playerUid && player.totalStars > 0)
        .reduce((best, player) => Math.max(best, techLevel(player, TECH.WEAPONS)), 1);
}

function techLevel(player: Player | undefined, kind: number) {
    if (!player) return 1;
    return numeric((player.tech[String(kind)] as TechInfo | undefined)?.level, 1);
}

function techName(kind: number) {
    switch (kind) {
        case TECH.BANKING:
            return "Banking";
        case TECH.RESEARCH:
            return "Research";
        case TECH.MANUFACTURING:
            return "Manufacturing";
        case TECH.WEAPONS:
            return "Weapons";
        default:
            return `tech ${kind}`;
    }
}

function numeric(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rounded(value: number) {
    return Math.round(value * 100) / 100;
}
