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
    solverMode: "portfolio";
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

interface PortfolioEvaluation extends ObjectiveResult {
    cashRemaining: number;
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
    const baseline = evaluatePortfolioObjective(scan, player, baselineStars, cashStart, horizonTicks, options.defenseGraph);
    if (spendable <= 0) {
        return emptyPlan(cashStart, baseline, horizonTicks, `no spendable cash after reserve $${reserve}`);
    }

    let explored = 0;
    const stateStars = cloneStars(ownedStars);
    const purchases: SolverInfraPurchase[] = [];
    let cash = cashStart;
    let current = baseline;

    while (cash - reserve > 0) {
        const candidate = bestPortfolioCandidate(scan, player, stateStars, cash, reserve, horizonTicks, current, options.defenseGraph);
        explored += candidate.explored;
        if (!candidate.best) break;
        const star = stateStars.find((entry) => entry.uid === candidate.best?.starUid);
        if (!star) break;
        applyPurchase(star, candidate.best.kind);
        cash -= candidate.best.cost;
        purchases.push({
            kind: candidate.best.kind,
            starUid: candidate.best.starUid,
            starName: star.n,
            cost: candidate.best.cost,
            utility: candidate.best.immediateUtility,
            score: candidate.best.score,
            reason: purchaseReason(candidate.best.kind, star, candidate.evaluation, horizonTicks),
        });
        current = candidate.evaluation;
        if (purchases.length >= 10000) break;
    }

    const finalObjective = evaluatePortfolioObjective(scan, player, stateStars, cash, horizonTicks, options.defenseGraph);
    const plan: DamageTickSolverPlan = {
        purchases,
        cashRemaining: cash,
        utility: finalObjective.objectiveValue - baseline.objectiveValue,
        objectiveValue: finalObjective.objectiveValue,
        baselineObjectiveValue: baseline.objectiveValue,
        explored,
        pruned: 0,
        horizonTicks,
        selectedResearchKind: finalObjective.selectedResearchKind,
        recommendResearchChange: finalObjective.recommendResearchChange,
        research: finalObjective.research,
        zones: finalObjective.zones,
        notes: [],
        solverMode: "portfolio",
    };
    if (plan.purchases.length === 0) {
        plan.notes = ["portfolio solver found no positive terminal-state infrastructure portfolio"];
    }
    return plan;
}

function bestPortfolioCandidate(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    cash: number,
    reserve: number,
    horizonTicks: number,
    current: PortfolioEvaluation,
    defenseGraph: DefenseGraphPlan | undefined,
) {
    let explored = 0;
    let best: Candidate | undefined;
    let evaluation = current;
    const spendable = cash - reserve;
    const canBuyEconomyNow = crossesProductionBoundaryNextTurn(scan);
    if (spendable <= 0) return { best, evaluation, explored };
    for (const star of stars) {
        const costs: Array<[SolverInfraKind, number]> = [
            ["economy", economyCostFor(scan.config, star)],
            ["industry", industryCostFor(scan.config, star)],
            ["science", scienceCostFor(scan.config, star)],
        ];
        for (const [kind, cost] of costs) {
            if (kind === "economy" && !canBuyEconomyNow) continue;
            if (cost > spendable) continue;
            const nextStars = cloneStars(stars);
            const nextStar = nextStars.find((entry) => entry.uid === star.uid);
            if (!nextStar) continue;
            applyPurchase(nextStar, kind);
            const candidateEvaluation = evaluatePortfolioObjective(scan, player, nextStars, cash - cost, horizonTicks, defenseGraph);
            explored += 1;
            const immediateUtility = candidateEvaluation.objectiveValue - current.objectiveValue;
            if (immediateUtility <= 0) continue;
            const candidate: Candidate = {
                kind,
                starUid: star.uid,
                cost,
                immediateUtility,
                score: immediateUtility / Math.max(1, cost),
            };
            if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.immediateUtility > best.immediateUtility)) {
                best = candidate;
                evaluation = candidateEvaluation;
            }
        }
    }
    return { best, evaluation, explored };
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
        solverMode: "portfolio",
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

function evaluatePortfolioObjective(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    cashRemaining: number,
    horizonTicks: number,
    defenseGraph: DefenseGraphPlan | undefined,
): PortfolioEvaluation {
    const objective = evaluateObjective(scan, player, stars, horizonTicks, defenseGraph);
    const projectedCash = cashRemaining + productionIncomeWithin(scan, player, stars, horizonTicks);
    return {
        ...objective,
        cashRemaining,
        objectiveValue: objective.objectiveValue
            + terminalInfrastructureValue(scan, player, stars, horizonTicks, defenseGraph)
            + projectedCash * terminalCashWeight(scan),
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
    const economyScore = productionEventsWithin(scan, horizonTicks) * projectedEconomy(stars) * 0.8;
    const scienceFloorScore = projectedScience * scienceStrategicWeight(scan, player) * 2.2;
    const objectiveValue = damageScore + scienceMomentum + researchCompletionBonus + economyScore + scienceFloorScore;
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
    return shipsPerTick / Math.max(1, enemyWeapons + 1) * Math.max(1, ownWeapons);
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

function terminalInfrastructureValue(
    scan: ScanningData,
    player: Player,
    stars: SolverStar[],
    horizonTicks: number,
    defenseGraph: DefenseGraphPlan | undefined,
) {
    const economy = projectedEconomy(stars);
    const industry = projectedIndustry(stars);
    const science = projectedScience(stars);
    const industryBalance = targetBalance(industry, Math.max(1, economy * 0.5));
    const scienceTarget = Math.max(1, economy * 0.25);
    const weaponsGap = Math.max(0, bestVisibleEnemyWeapons(scan) - techLevel(player, TECH.WEAPONS));
    const scienceUrgency = Math.min(1.5, weaponsGap / 8);
    const productionCycleValue = productionEventsWithin(scan, horizonTicks) * 0.8
        + Math.max(1, horizonTicks / Math.max(1, scan.productionRate)) * 0.35;
    let total = economy * productionCycleValue
        + balancedUnitValue(stars, (star) => star.e, Number.POSITIVE_INFINITY, productionCycleValue * 1.8, (star) => defendabilityWeight(defenseGraph, star))
        + balancedUnitValue(stars, (star) => star.s, scienceTarget, 42 + scienceUrgency * 10, (star) => defendabilityWeight(defenseGraph, star))
        + balancedUnitValue(stars, (star) => star.s, Number.POSITIVE_INFINITY, 2, (star) => defendabilityWeight(defenseGraph, star));
    for (const star of stars) {
        const frontier = Math.max(0.35, Math.min(2.5, numeric(star.frontierWeight, 1)));
        total += infrastructureBookValue(scan.config, star, "industry") * (0.02 + industryBalance * (0.42 + frontier * 0.08));
    }
    return total;
}

function balancedUnitValue(
    stars: SolverStar[],
    units: (star: SolverStar) => number,
    target: number,
    unitValue: number,
    locationWeight: (star: SolverStar) => number,
) {
    const weights = stars.flatMap((star) => Array(Math.max(0, units(star))).fill(locationWeight(star)) as number[]);
    return weights
        .sort((a, b) => b - a)
        .reduce((total, weight, index) => total + weight * unitValue * balanceMarginal(index, target), 0);
}

function balanceMarginal(index: number, target: number) {
    if (!Number.isFinite(target)) return 1;
    const ratio = index / Math.max(1, target);
    if (ratio >= 1) return 0;
    return 1 - ratio * ratio;
}

function defendabilityWeight(defenseGraph: DefenseGraphPlan | undefined, star: SolverStar) {
    const analysis = defenseGraph?.starAnalyses.find((entry) => entry.starUid === star.uid);
    if (!analysis) return 1;
    switch (analysis.classification) {
        case "interior":
            return 1.35;
        case "covered":
            return 1.2;
        case "self_hub":
            return 1.05;
        case "exposed_high_value":
            return 0.65;
        case "exposed_low_value":
            return 0.25;
    }
}

function targetBalance(value: number, target: number) {
    const ratio = value / Math.max(1, target);
    if (ratio >= 1) return 0;
    return 1 - ratio * ratio;
}

function terminalCashWeight(scan: ScanningData) {
    return crossesProductionBoundaryNextTurn(scan) ? 0.08 : 0.16;
}

function projectedScience(stars: SolverStar[]) {
    return stars.reduce((total, star) => total + Math.max(0, star.s), 0);
}

function projectedEconomy(stars: SolverStar[]) {
    return stars.reduce((total, star) => total + Math.max(0, star.e), 0);
}

function projectedIndustry(stars: SolverStar[]) {
    return stars.reduce((total, star) => total + Math.max(0, star.i), 0);
}

function scienceStrategicWeight(scan: ScanningData, player: Player) {
    const ownWeapons = techLevel(player, TECH.WEAPONS);
    const bestEnemy = bestVisibleEnemyWeapons(scan);
    const behind = Math.max(0, bestEnemy - ownWeapons);
    const researchingWeapons = player.researching === TECH.WEAPONS ? 1.5 : 1;
    return researchingWeapons * (1 + behind * 0.75);
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

function productionIncomeWithin(scan: ScanningData, player: Player, stars: SolverStar[], horizonTicks: number) {
    const incomePerEconomy = 10 + 2 * techLevel(player, TECH.BANKING);
    return productionEventsWithin(scan, horizonTicks) * projectedEconomy(stars) * incomePerEconomy;
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

function infrastructureBookValue(config: GameConfig, star: ScannedStar, kind: SolverInfraKind) {
    const levels = kind === "economy" ? star.e : kind === "industry" ? star.i : star.s;
    const factor = kind === "economy" ? 2.5 : kind === "industry" ? 5 : 20;
    const devCost = kind === "economy" ? config.devCostEco : kind === "industry" ? config.devCostInd : config.devCostSci;
    const resource = Math.max(0.01, star.r / 100);
    return factor * devCost * levels * (levels + 1) / 2 / resource;
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
