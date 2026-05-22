import type { Fleet, GameConfig, Player, ScannedStar, ScanningData, Star, TechInfo } from "./types.js";
import type { PlannedCommand } from "./command.js";
import { estimateStarBattle, projectedStarShips, type BattleEstimate } from "./battle.js";

export interface PlannerConfig {
    horizonTicks: number;
    cashReserveRatio: number;
    buildCarrier: boolean;
    markReady: boolean;
}

export interface DecisionRecord {
    metadata: {
        gameName: string;
        playerUid: number;
        tick: number;
        tickFragment: number;
        productionCounter: number;
        productionRate: number;
        turnBased: 0 | 1;
        dryRun: boolean;
    };
    summary: {
        cashStart: number;
        cashRemaining: number;
        ownedScannedStars: number;
        ownedFleets: number;
        commandsPlanned: number;
        diplomacyDraftsPlanned: number;
    };
    commands: PlannedCommand[];
    diplomacyDrafts: DiplomacyDraft[];
    combat: CombatSummary;
    rejected: string[];
}

export interface DiplomacyDraft {
    recipientUid: number;
    recipientAlias: string;
    recipientColor: number;
    fromColor: string;
    friendly: boolean;
    subject: string;
    body: string;
    reason: string;
    context?: string;
    threadKey?: string;
    persona?: string;
    plainSubject?: string;
    plainBody?: string;
    flavorError?: string;
}

interface MutableStar extends ScannedStar {
    frontierWeight: number;
}

type InfraKind = "economy" | "industry" | "science";

interface InfraCandidate {
    kind: InfraKind;
    star: MutableStar;
    cost: number;
    score: number;
}

interface CarrierPlan {
    buildCount: number;
    buildCost: number;
}

interface NeutralTarget {
    star: Star;
    nearestOwnedDistance: number;
}

interface NewCarrierAssignment {
    source: MutableStar;
    target: Star;
    distance: number;
    eta: number;
}

interface CarrierExecution {
    cash: number;
    builtCount: number;
}

interface StagingAssignment {
    source: MutableStar;
    target: MutableStar;
    ships: number;
    distance: number;
    eta: number;
}

interface FleetRouteAssignment {
    fleet: Fleet;
    target: Star;
    eta: number;
    role: "attack" | "defend" | "rally";
    reason: string;
}

interface IncomingAttack {
    fleet: Fleet;
    attacker: Player;
    target: MutableStar;
    eta: number;
    estimate: BattleEstimate;
}

interface PotentialThreat {
    attackerUid: number;
    attackerAlias: string;
    originName: string;
    target: MutableStar;
    eta: number;
    ships: number;
    estimate: BattleEstimate;
}

interface EnemyOrigin {
    puid: number;
    x: number;
    y: number;
    st: number;
    speed: number;
    n: string;
}

interface RallyPlan {
    rallyStar: MutableStar;
    coveredTargets: MutableStar[];
    requiredShips: number;
    availableShips: number;
}

interface TacticalPlan {
    assignments: FleetRouteAssignment[];
    incomingAttacks: IncomingAttack[];
    attackOpportunities: FleetRouteAssignment[];
    defenseAssignments: FleetRouteAssignment[];
    rallyAssignments: FleetRouteAssignment[];
    rallyPlan?: RallyPlan;
}

export interface CombatSummary {
    incomingAttacks: Array<{
        attackerUid: number;
        attackerAlias: string;
        fleetUid: number;
        targetUid: number;
        targetName: string;
        eta: number;
        attackerShips: number;
        defenderShips: number;
        attackerWins: boolean;
        additionalDefendersNeeded: number;
    }>;
    plannedAttacks: Array<{
        fleetUid: number;
        targetUid: number;
        targetName: string;
        eta: number;
        reason: string;
    }>;
    plannedDefenses: Array<{
        fleetUid: number;
        targetUid: number;
        targetName: string;
        eta: number;
        reason: string;
    }>;
    rally?: {
        starUid: number;
        starName: string;
        coveredTargetNames: string[];
        requiredShips: number;
        availableShips: number;
    };
}

interface DiplomacyMessage {
    created?: unknown;
    player_uid?: unknown;
    payload?: {
        from_uid?: unknown;
        to_uids?: unknown;
        created?: unknown;
        body?: unknown;
    };
    comments?: DiplomacyComment[];
}

interface DiplomacyComment {
    created?: unknown;
    player_uid?: unknown;
    payload?: {
        senderUid?: unknown;
        from_uid?: unknown;
        created?: unknown;
        body?: unknown;
    };
}

interface DiplomacyEvent {
    created: number;
    fromUid: number;
    toUids: number[];
    threadKey?: string;
    body?: string;
}

const TECH = {
    BANKING: 0,
    RESEARCH: 1,
    MANUFACTURING: 2,
    PROPULSION: 3,
    SCANNING: 4,
    WEAPONS: 5,
    TERRAFORMING: 6,
} as const;

export function planTurn(
    scan: ScanningData,
    config: PlannerConfig,
    dryRun: boolean,
    diplomacyMessages: unknown[] = [],
): DecisionRecord {
    const player = scan.players[String(scan.playerUid)];
    if (!player) {
        throw new Error(`Player ${scan.playerUid} was not present in scan`);
    }

    const commands: PlannedCommand[] = [];
    const rejected: string[] = [];
    const stars = ownedScannedStars(scan).map((star) => ({
        ...star,
        frontierWeight: frontierWeight(scan, star),
    }));
    const ownFleets = Object.values(scan.fleets).filter((fleet) => fleet.puid === scan.playerUid);
    const tacticalPlan = planTactics(scan, stars, ownFleets, rejected);
    const tacticalFleetUids = new Set(tacticalPlan.assignments.map((assignment) => assignment.fleet.uid));
    const carrierPlan = config.buildCarrier
        ? planCarrierCoverage(scan, stars, ownFleets, tacticalFleetUids)
        : { buildCount: 0, buildCost: 0 };

    let cash = safeNumber(player.cash, 0);
    const reserve = Math.max(
        Math.floor(cash * config.cashReserveRatio),
        carrierPlan.buildCost,
    );
    cash = buyInfrastructure(scan, player, stars, cash, reserve, config, commands, rejected);

    executeTacticalRoutes(tacticalPlan, commands);

    let builtCarriersThisTurn = 0;
    if (config.buildCarrier) {
        const carrierExecution = executeCarrierCoverage(scan, stars, ownFleets, tacticalFleetUids, cash, commands, rejected);
        cash = carrierExecution.cash;
        builtCarriersThisTurn += carrierExecution.builtCount;
        const stagingExecution = executeShipStaging(scan, stars, cash, builtCarriersThisTurn, commands, rejected);
        cash = stagingExecution.cash;
        builtCarriersThisTurn += stagingExecution.builtCount;
    }

    if (config.markReady && scan.turnBased === 1 && player.ready !== 1) {
        commands.push({
            kind: "ready",
            order: "force_ready",
            reason: "mark-ready was requested for a turn-based game",
        });
    }

    const diplomacyDrafts = draftDiplomacy(scan, diplomacyMessages);

    return {
        metadata: {
            gameName: scan.name,
            playerUid: scan.playerUid,
            tick: scan.tick,
            tickFragment: scan.tickFragment,
            productionCounter: scan.productionCounter,
            productionRate: scan.productionRate,
            turnBased: scan.turnBased,
            dryRun,
        },
        summary: {
            cashStart: safeNumber(player.cash, 0),
            cashRemaining: cash,
            ownedScannedStars: stars.length,
            ownedFleets: ownFleets.length,
            commandsPlanned: commands.length,
            diplomacyDraftsPlanned: diplomacyDrafts.length,
        },
        commands,
        diplomacyDrafts,
        combat: combatSummary(tacticalPlan),
        rejected,
    };
}

function buyInfrastructure(
    scan: ScanningData,
    player: Player,
    stars: MutableStar[],
    cashStart: number,
    reserve: number,
    plannerConfig: PlannerConfig,
    commands: PlannedCommand[],
    rejected: string[],
) {
    let cash = cashStart;
    let purchases = 0;
    const maxPurchases = 64;
    while (purchases < maxPurchases) {
        const spendable = cash - reserve;
        if (spendable <= 0) {
            rejected.push(`stopped infrastructure purchases with $${cash}; reserve is $${reserve}`);
            break;
        }

        const candidate = bestInfraCandidate(scan, player, stars, spendable, plannerConfig);
        if (!candidate) {
            rejected.push(
                `stopped infrastructure after ${purchases} purchases; no additional candidate passed affordability, production-timing, and ratio-cap filters within spendable budget $${spendable}`,
            );
            break;
        }

        applyInfraPurchase(candidate);
        cash -= candidate.cost;
        purchases += 1;
        commands.push({
            kind: "batched_order",
            order: `upgrade_${candidate.kind},${candidate.star.uid},${candidate.cost}`,
            reason: `${candidate.kind} at ${candidate.star.n} scored ${candidate.score.toFixed(4)} within $${spendable} spendable`,
        });
    }
    return cash;
}

function bestInfraCandidate(
    scan: ScanningData,
    player: Player,
    stars: MutableStar[],
    spendable: number,
    plannerConfig: PlannerConfig,
) {
    const gameConfig = scan.config;
    const candidates: InfraCandidate[] = [];
    const productionCycles = Math.max(
        1,
        Math.floor((plannerConfig.horizonTicks + gameConfig.prodTicks - 1) / Math.max(1, gameConfig.prodTicks)),
    );
    const manufacturing = techLevel(player, TECH.MANUFACTURING);
    const buyEconomy = crossesProductionBoundaryNextTurn(scan);

    for (const star of stars) {
        const ecoCost = economyCostFor(gameConfig, star);
        if (buyEconomy && ecoCost <= spendable) {
            candidates.push({
                kind: "economy",
                star,
                cost: ecoCost,
                score: (productionCycles * 10) / ecoCost,
            });
        }

        if (buyEconomy) {
            continue;
        }

        const industryCost = industryCostFor(gameConfig, star);
        if (industryCost <= spendable && belowIndustryCapAfterPurchase(star)) {
            const shipsByHorizon = (plannerConfig.horizonTicks / Math.max(1, gameConfig.prodTicks)) * (manufacturing + 4);
            candidates.push({
                kind: "industry",
                star,
                cost: industryCost,
                score: (shipsByHorizon * star.frontierWeight) / industryCost,
            });
        }

        const scienceCost = scienceCostFor(gameConfig, star);
        if (scienceCost <= spendable && belowScienceCapAfterPurchase(star)) {
            const scienceNeed = Math.max(0.25, player.totalIndustry / Math.max(1, player.totalScience * 4));
            candidates.push({
                kind: "science",
                star,
                cost: scienceCost,
                score: scienceNeed / scienceCost,
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score || a.cost - b.cost);
    return candidates[0];
}

function belowIndustryCapAfterPurchase(star: MutableStar) {
    return star.i + 1 <= star.e / 2;
}

function belowScienceCapAfterPurchase(star: MutableStar) {
    return star.s + 1 <= star.i / 2;
}

function crossesProductionBoundaryNextTurn(scan: ScanningData) {
    const nextTurnTicks = scan.turnBased === 1
        ? Math.max(1, scan.config.turnJumpTicks)
        : 1;
    return scan.productionCounter + nextTurnTicks >= scan.productionRate;
}

function applyInfraPurchase(candidate: InfraCandidate) {
    if (candidate.kind === "economy") candidate.star.e += 1;
    if (candidate.kind === "industry") candidate.star.i += 1;
    if (candidate.kind === "science") candidate.star.s += 1;
}

function planTactics(
    scan: ScanningData,
    stars: MutableStar[],
    ownFleets: Fleet[],
    rejected: string[],
): TacticalPlan {
    const assignments: FleetRouteAssignment[] = [];
    const assignedFleetUids = new Set<number>();
    const incomingAttacks = visibleIncomingAttacks(scan, stars);
    for (const attack of incomingAttacks) {
        rejected.push(incomingAttackSummary(attack));
    }

    const defenseAssignments = assignDirectDefenses(scan, ownFleets, incomingAttacks, assignedFleetUids);
    assignments.push(...defenseAssignments);

    const rallyPlan = chooseRallyPlan(scan, stars, ownFleets, assignedFleetUids);
    const rallyAssignments = rallyPlan
        ? assignRallyReinforcements(scan, ownFleets, rallyPlan, assignedFleetUids)
        : [];
    assignments.push(...rallyAssignments);

    const attackOpportunities = assignWinningAttacks(scan, ownFleets, assignedFleetUids);
    assignments.push(...attackOpportunities);

    if (incomingAttacks.length === 0 && attackOpportunities.length === 0 && !rallyPlan) {
        rejected.push("no visible incoming attacks, winning carrier attacks, or useful rally point found");
    }

    const plan: TacticalPlan = {
        assignments,
        incomingAttacks,
        attackOpportunities,
        defenseAssignments,
        rallyAssignments,
    };
    if (rallyPlan) plan.rallyPlan = rallyPlan;
    return plan;
}

function executeTacticalRoutes(plan: TacticalPlan, commands: PlannedCommand[]) {
    for (const assignment of plan.assignments) {
        commands.push({
            kind: "fleet_order",
            order: `add_fleet_orders,${assignment.fleet.uid},0,${assignment.target.uid},0,0,0`,
            reason: assignment.reason,
        });
    }
}

function combatSummary(plan: TacticalPlan): CombatSummary {
    const summary: CombatSummary = {
        incomingAttacks: plan.incomingAttacks.map((attack) => ({
            attackerUid: attack.attacker.uid,
            attackerAlias: attack.attacker.alias,
            fleetUid: attack.fleet.uid,
            targetUid: attack.target.uid,
            targetName: attack.target.n,
            eta: rounded(attack.eta),
            attackerShips: attack.estimate.attackerShips,
            defenderShips: attack.estimate.defenderShips,
            attackerWins: attack.estimate.attackerWins,
            additionalDefendersNeeded: attack.estimate.additionalDefendersNeeded,
        })),
        plannedAttacks: plan.attackOpportunities.map(routeSummary),
        plannedDefenses: [...plan.defenseAssignments, ...plan.rallyAssignments].map(routeSummary),
    };
    if (plan.rallyPlan) {
        summary.rally = {
            starUid: plan.rallyPlan.rallyStar.uid,
            starName: plan.rallyPlan.rallyStar.n,
            coveredTargetNames: plan.rallyPlan.coveredTargets.map((star) => star.n),
            requiredShips: plan.rallyPlan.requiredShips,
            availableShips: plan.rallyPlan.availableShips,
        };
    }
    return summary;
}

function routeSummary(assignment: FleetRouteAssignment) {
    return {
        fleetUid: assignment.fleet.uid,
        targetUid: assignment.target.uid,
        targetName: assignment.target.n,
        eta: rounded(assignment.eta),
        reason: assignment.reason,
    };
}

function rounded(value: number) {
    return Math.round(value * 10) / 10;
}

function planCarrierCoverage(scan: ScanningData, stars: MutableStar[], fleets: Fleet[], unavailableFleetUids: Set<number>): CarrierPlan {
    const { newCarrierAssignments } = assignCarrierCoverage(scan, stars, fleets, unavailableFleetUids);
    return {
        buildCount: newCarrierAssignments.length,
        buildCost: newCarrierAssignments.reduce((total, _assignment, index) => total + carrierCostFor(scan.config, index), 0),
    };
}

function executeCarrierCoverage(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    cashStart: number,
    commands: PlannedCommand[],
    rejected: string[],
) {
    let cash = cashStart;
    const { fleetAssignments, newCarrierAssignments, uncoveredNeutralTargets } = assignCarrierCoverage(scan, stars, fleets, unavailableFleetUids);

    for (const assignment of fleetAssignments) {
        commands.push({
            kind: "fleet_order",
            order: `add_fleet_orders,${assignment.fleet.uid},0,${assignment.target.uid},0,0,0`,
            reason: `idle carrier ${assignment.fleet.uid} routed to neutral ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} ticks within expansion horizon`,
        });
    }

    let built = 0;
    for (const assignment of newCarrierAssignments) {
        const cost = carrierCostFor(scan.config, built);
        if (cash < cost) {
            rejected.push(`not enough cash to build carrier for ${assignment.target.n}: $${cash} < $${cost}`);
            continue;
        }
        cash -= cost;
        built += 1;
        assignment.source.st -= 1;
        const command: PlannedCommand = {
            kind: "new_fleet",
            order: `new_fleet,${assignment.source.uid},1`,
            reason: `build carrier at ${assignment.source.n} for neutral ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} ticks within expansion horizon`,
        };
        command.followUpTargetUid = assignment.target.uid;
        command.followUpReason = `route new carrier to neutral ${assignment.target.n}`;
        commands.push(command);
    }

    for (const target of uncoveredNeutralTargets) {
        rejected.push(`neutral ${target.star.n} is reachable within expansion horizon but has no available carrier source`);
    }

    if (fleetAssignments.length === 0 && newCarrierAssignments.length === 0 && uncoveredNeutralTargets.length === 0) {
        rejected.push("no uncovered neutral stars can be reached within expansion horizon");
    }

    return { cash, builtCount: built };
}

function executeShipStaging(
    scan: ScanningData,
    stars: MutableStar[],
    cashStart: number,
    builtCarriersThisTurn: number,
    commands: PlannedCommand[],
    rejected: string[],
): CarrierExecution {
    let cash = cashStart;
    if (cash < 200) {
        rejected.push(`skipped ship staging because cash $${cash} is below the $200 staging reserve`);
        return { cash, builtCount: 0 };
    }

    const assignment = stagingAssignment(scan, stars);
    if (!assignment) {
        rejected.push(`no owned star with more ships than tick ${scan.tick} can stage closer toward an enemy empire`);
        return { cash, builtCount: 0 };
    }

    const cost = carrierCostFor(scan.config, builtCarriersThisTurn);
    if (cash < cost) {
        rejected.push(`not enough cash to build staging carrier from ${assignment.source.n}: $${cash} < $${cost}`);
        return { cash, builtCount: 0 };
    }

    cash -= cost;
    assignment.source.st -= assignment.ships;
    const command: PlannedCommand = {
        kind: "new_fleet",
        order: `new_fleet,${assignment.source.uid},${assignment.ships}`,
        reason: `stage ${assignment.ships} ships from ${assignment.source.n} toward enemy space via ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} ticks`,
        followUpTargetUid: assignment.target.uid,
        followUpReason: `route staging carrier from ${assignment.source.n} to ${assignment.target.n}`,
    };
    commands.push(command);
    return { cash, builtCount: 1 };
}

function assignCarrierCoverage(scan: ScanningData, stars: MutableStar[], fleets: Fleet[], unavailableFleetUids: Set<number>) {
    const expansionHorizonTicks = expansionHorizon(scan);
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const speed = Math.max(scan.fleetSpeed, 0.0001);
    const assignedTargets = new Set<number>();
    const fleetAssignments: { fleet: Fleet; target: Star; eta: number }[] = [];
    const newCarrierAssignments: NewCarrierAssignment[] = [];
    const sourceShips = new Map<number, number>(stars.map((star) => [star.uid, Math.max(0, star.st - 1)]));
    const idleFleets = fleets
        .filter((fleet) => fleet.o.length === 0 && fleet.st > 0 && Boolean(fleet.ouid) && !unavailableFleetUids.has(fleet.uid))
        .sort((a, b) => b.st - a.st || a.uid - b.uid);
    const neutralTargets = reachableNeutralTargets(scan, stars, range, speed, expansionHorizonTicks);
    for (const fleet of fleets) {
        const targetUid = fleet.o[0]?.[1];
        const target = targetUid === undefined ? undefined : scan.stars[String(targetUid)];
        if (!target || !isNeutralStar(target)) continue;
        const fleetSpeed = Math.max(fleet.speed || scan.fleetSpeed, 0.0001);
        const eta = etaTicks(starDistance(fleet, target), fleetSpeed);
        if (eta <= expansionHorizonTicks) {
            assignedTargets.add(target.uid);
        }
    }

    for (const fleet of idleFleets) {
        const target = nearestReachableNeutralForFleet(scan, fleet, neutralTargets, assignedTargets, range, expansionHorizonTicks);
        if (!target) continue;
        assignedTargets.add(target.star.uid);
        fleetAssignments.push({ fleet, target: target.star, eta: target.eta });
    }

    for (const target of neutralTargets) {
        if (assignedTargets.has(target.star.uid)) continue;
        const source = bestCarrierSource(stars, sourceShips, target.star, range, speed, expansionHorizonTicks);
        if (!source) continue;
        assignedTargets.add(target.star.uid);
        sourceShips.set(source.source.uid, (sourceShips.get(source.source.uid) ?? 0) - 1);
        newCarrierAssignments.push({
            source: source.source,
            target: target.star,
            distance: source.distance,
            eta: source.eta,
        });
    }

    return {
        fleetAssignments,
        newCarrierAssignments,
        uncoveredNeutralTargets: neutralTargets.filter((target) => !assignedTargets.has(target.star.uid)),
    };
}

function stagingAssignment(scan: ScanningData, stars: MutableStar[]): StagingAssignment | undefined {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const speed = Math.max(scan.fleetSpeed, 0.0001);
    const enemyStars = Object.values(scan.stars)
        .filter((star) => star.puid > 0 && star.puid !== scan.playerUid && activePlayer(scan, star.puid));
    if (enemyStars.length === 0) return undefined;

    return stars
        .filter((source) => source.st > scan.tick)
        .sort((a, b) => b.st - a.st || a.uid - b.uid)
        .flatMap((source) => {
            const sourceEnemyDistance = nearestDistanceToStars(source, enemyStars);
            return stars
                .filter((target) => target.uid !== source.uid)
                .map((target) => {
                    const distance = starDistance(source, target);
                    const targetEnemyDistance = nearestDistanceToStars(target, enemyStars);
                    return {
                        source,
                        target,
                        ships: Math.max(1, Math.floor(source.st / 2)),
                        distance,
                        eta: etaTicks(distance, speed),
                        progress: sourceEnemyDistance - targetEnemyDistance,
                    };
                })
                .filter((assignment) => assignment.distance <= range && assignment.progress > 0);
        })
        .sort((a, b) => b.source.st - a.source.st
            || b.progress - a.progress
            || a.eta - b.eta
            || a.target.uid - b.target.uid)[0];
}

function visibleIncomingAttacks(scan: ScanningData, stars: MutableStar[]): IncomingAttack[] {
    const starsByUid = new Map(stars.map((star) => [star.uid, star]));
    return Object.values(scan.fleets)
        .filter((fleet) => fleet.puid !== scan.playerUid && fleet.o.length > 0)
        .map((fleet) => {
            const [delay, targetUid] = fleet.o[0] ?? [];
            const target = targetUid === undefined ? undefined : starsByUid.get(targetUid);
            const attacker = scan.players[String(fleet.puid)];
            if (!target || !attacker) return undefined;
            const eta = safeNumber(delay, 0) + etaTicks(starDistance(fleet, target), Math.max(fleet.speed || scan.fleetSpeed, 0.0001));
            const estimate = estimateStarBattle(
                scan,
                fleet.puid,
                fleet.st,
                target,
                eta,
                orbitingShipsAt(scan, target.uid, target.puid, eta),
            );
            return { fleet, attacker, target, eta, estimate };
        })
        .filter((attack): attack is IncomingAttack => Boolean(attack))
        .sort((a, b) => a.eta - b.eta || b.fleet.st - a.fleet.st || a.fleet.uid - b.fleet.uid);
}

function assignDirectDefenses(
    scan: ScanningData,
    ownFleets: Fleet[],
    incomingAttacks: IncomingAttack[],
    assignedFleetUids: Set<number>,
) {
    const assignments: FleetRouteAssignment[] = [];
    for (const attack of incomingAttacks.filter((entry) => entry.estimate.attackerWins)) {
        let supportShips = 0;
        let estimate = attack.estimate;
        while (estimate.attackerWins) {
            const fleet = bestDefensiveFleet(scan, ownFleets, assignedFleetUids, attack, supportShips);
            if (!fleet) break;
            assignedFleetUids.add(fleet.uid);
            supportShips += fleet.st;
            const eta = etaFromFleet(scan, fleet, attack.target);
            assignments.push({
                fleet,
                target: attack.target,
                eta,
                role: "defend",
                reason: `reinforce ${attack.target.n} against ${attack.attacker.alias} fleet ${attack.fleet.uid}; ${fleet.st} ships arrive in ${eta.toFixed(1)} ticks before enemy eta ${attack.eta.toFixed(1)}`,
            });
            estimate = estimateStarBattle(
                scan,
                attack.fleet.puid,
                attack.fleet.st,
                attack.target,
                attack.eta,
                orbitingShipsAt(scan, attack.target.uid, attack.target.puid, attack.eta) + supportShips,
            );
        }
    }
    return assignments;
}

function bestDefensiveFleet(
    scan: ScanningData,
    ownFleets: Fleet[],
    assignedFleetUids: Set<number>,
    attack: IncomingAttack,
    supportShips: number,
) {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    return idleOrbitingFleets(ownFleets, assignedFleetUids)
        .map((fleet) => ({
            fleet,
            eta: etaFromFleet(scan, fleet, attack.target),
            distance: distanceFromFleetOrigin(scan, fleet, attack.target),
        }))
        .filter((candidate) => candidate.distance <= range && candidate.eta < attack.eta)
        .map((candidate) => ({
            ...candidate,
            estimate: estimateStarBattle(
                scan,
                attack.fleet.puid,
                attack.fleet.st,
                attack.target,
                attack.eta,
                orbitingShipsAt(scan, attack.target.uid, attack.target.puid, attack.eta) + supportShips + candidate.fleet.st,
            ),
        }))
        .sort((a, b) => Number(a.estimate.attackerWins) - Number(b.estimate.attackerWins)
            || b.fleet.st - a.fleet.st
            || a.eta - b.eta
            || a.fleet.uid - b.fleet.uid)[0]?.fleet;
}

function chooseRallyPlan(
    scan: ScanningData,
    stars: MutableStar[],
    ownFleets: Fleet[],
    assignedFleetUids: Set<number>,
): RallyPlan | undefined {
    const threats = potentialThreats(scan, stars);
    if (threats.length === 0) return undefined;
    const range = rangeValue(scan.players[String(scan.playerUid)]);

    return stars
        .map((rallyStar) => {
            const coveredThreats = threats.filter((threat) => {
                const eta = etaTicks(starDistance(rallyStar, threat.target), Math.max(scan.fleetSpeed, 0.0001));
                return starDistance(rallyStar, threat.target) <= range && eta <= threat.eta;
            });
            const coveredTargets = uniqueStars(coveredThreats.map((threat) => threat.target));
            const requiredShips = Math.max(0, ...coveredThreats.map((threat) => threat.estimate.additionalDefendersNeeded));
            const availableShips = rallyAvailableShips(scan, ownFleets, rallyStar, assignedFleetUids);
            return { rallyStar, coveredTargets, requiredShips, availableShips };
        })
        .filter((plan) => plan.coveredTargets.length > 0 && plan.requiredShips > plan.availableShips)
        .sort((a, b) => b.coveredTargets.length - a.coveredTargets.length
            || b.requiredShips - a.requiredShips
            || b.availableShips - a.availableShips
            || a.rallyStar.uid - b.rallyStar.uid)[0];
}

function assignRallyReinforcements(
    scan: ScanningData,
    ownFleets: Fleet[],
    rallyPlan: RallyPlan,
    assignedFleetUids: Set<number>,
) {
    const assignments: FleetRouteAssignment[] = [];
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    let availableShips = rallyPlan.availableShips;

    for (const candidate of idleOrbitingFleets(ownFleets, assignedFleetUids)
        .filter((fleet) => fleet.ouid !== rallyPlan.rallyStar.uid)
        .map((fleet) => ({
            fleet,
            eta: etaFromFleet(scan, fleet, rallyPlan.rallyStar),
            distance: distanceFromFleetOrigin(scan, fleet, rallyPlan.rallyStar),
        }))
        .filter((candidate) => candidate.distance <= range && candidate.eta <= expansionHorizon(scan))
        .sort((a, b) => b.fleet.st - a.fleet.st || a.eta - b.eta || a.fleet.uid - b.fleet.uid)) {
        if (availableShips >= rallyPlan.requiredShips) break;
        assignedFleetUids.add(candidate.fleet.uid);
        availableShips += candidate.fleet.st;
        assignments.push({
            fleet: candidate.fleet,
            target: rallyPlan.rallyStar,
            eta: candidate.eta,
            role: "rally",
            reason: `mass ${candidate.fleet.st} ships at ${rallyPlan.rallyStar.n}; rally covers ${rallyPlan.coveredTargets.map((star) => star.n).join(", ")} and needs ${rallyPlan.requiredShips} ships`,
        });
    }
    return assignments;
}

function assignWinningAttacks(scan: ScanningData, ownFleets: Fleet[], assignedFleetUids: Set<number>) {
    const assignments: FleetRouteAssignment[] = [];
    const attackedTargetUids = new Set<number>();
    const enemyTargets = Object.values(scan.stars)
        .filter((star): star is ScannedStar => isScanned(star) && star.puid > 0 && star.puid !== scan.playerUid)
        .sort((a, b) => b.st - a.st || a.uid - b.uid);
    const range = rangeValue(scan.players[String(scan.playerUid)]);

    for (const fleet of idleOrbitingFleets(ownFleets, assignedFleetUids)) {
        const attack = enemyTargets
            .filter((target) => !attackedTargetUids.has(target.uid))
            .map((target) => {
                const distance = distanceFromFleetOrigin(scan, fleet, target);
                const eta = etaFromFleet(scan, fleet, target);
                const estimate = estimateStarBattle(scan, scan.playerUid, fleet.st, target, eta, orbitingShipsAt(scan, target.uid, target.puid, eta));
                return { target, distance, eta, estimate };
            })
            .filter((candidate) => candidate.distance <= range && candidate.estimate.attackerWins)
            .sort((a, b) => b.estimate.attackerRemaining - a.estimate.attackerRemaining
                || a.eta - b.eta
                || b.target.st - a.target.st
                || a.target.uid - b.target.uid)[0];
        if (!attack) continue;
        assignedFleetUids.add(fleet.uid);
        attackedTargetUids.add(attack.target.uid);
        assignments.push({
            fleet,
            target: attack.target,
            eta: attack.eta,
            role: "attack",
            reason: `attack ${attack.target.n}; carrier ${fleet.uid} wins with ${attack.estimate.attackerRemaining} ships remaining by battle estimate`,
        });
    }
    return assignments;
}

function potentialThreats(scan: ScanningData, stars: MutableStar[]): PotentialThreat[] {
    const horizon = expansionHorizon(scan);
    const threats: PotentialThreat[] = [];
    for (const origin of visibleEnemyOrigins(scan)) {
        const player = scan.players[String(origin.puid)];
        if (!player) continue;
        const range = rangeValue(player);
        for (const target of stars) {
            const distance = starDistance(origin, target);
            const eta = etaTicks(distance, Math.max(origin.speed || scan.fleetSpeed, 0.0001));
            if (distance > range || eta > horizon) continue;
            const estimate = estimateStarBattle(
                scan,
                origin.puid,
                origin.st,
                target,
                eta,
                orbitingShipsAt(scan, target.uid, target.puid, eta),
            );
            threats.push({
                attackerUid: origin.puid,
                attackerAlias: player.alias,
                originName: origin.n,
                target,
                eta,
                ships: origin.st,
                estimate,
            });
        }
    }
    return threats.sort((a, b) => b.estimate.additionalDefendersNeeded - a.estimate.additionalDefendersNeeded || a.eta - b.eta);
}

function visibleEnemyOrigins(scan: ScanningData): EnemyOrigin[] {
    return [
        ...Object.values(scan.stars)
            .filter((star): star is ScannedStar => isScanned(star) && star.puid > 0 && star.puid !== scan.playerUid)
            .map((star) => ({
                puid: star.puid,
                x: star.x,
                y: star.y,
                st: star.st,
                speed: scan.fleetSpeed,
                n: star.n,
            })),
        ...Object.values(scan.fleets)
            .filter((fleet) => fleet.puid !== scan.playerUid && fleet.st > 0)
            .map((fleet) => ({
                puid: fleet.puid,
                x: fleet.x,
                y: fleet.y,
                st: fleet.st,
                speed: Math.max(fleet.speed || scan.fleetSpeed, 0.0001),
                n: `fleet ${fleet.uid}`,
            })),
    ];
}

function incomingAttackSummary(attack: IncomingAttack) {
    const outcome = attack.estimate.attackerWins
        ? `loses without ${attack.estimate.additionalDefendersNeeded} more defenders`
        : `holds with ${attack.estimate.defenderRemaining} ships`;
    return `${attack.attacker.alias} fleet ${attack.fleet.uid} is attacking ${attack.target.n}; eta ${attack.eta.toFixed(1)} ticks, ${outcome}`;
}

function idleOrbitingFleets(fleets: Fleet[], assignedFleetUids: Set<number>) {
    return fleets
        .filter((fleet) => fleet.o.length === 0 && fleet.st > 0 && Boolean(fleet.ouid) && !assignedFleetUids.has(fleet.uid))
        .sort((a, b) => b.st - a.st || a.uid - b.uid);
}

function distanceFromFleetOrigin(scan: ScanningData, fleet: Fleet, target: Star) {
    const origin = scan.stars[String(fleet.ouid)];
    return origin ? starDistance(origin, target) : Number.POSITIVE_INFINITY;
}

function etaFromFleet(scan: ScanningData, fleet: Fleet, target: Star) {
    return etaTicks(distanceFromFleetOrigin(scan, fleet, target), Math.max(fleet.speed || scan.fleetSpeed, 0.0001));
}

function orbitingShipsAt(scan: ScanningData, starUid: number, ownerUid: number, ticksUntilArrival: number) {
    return Object.values(scan.fleets)
        .filter((fleet) => fleet.puid === ownerUid && fleet.ouid === starUid)
        .filter((fleet) => fleet.o.length === 0 || safeNumber(fleet.o[0]?.[0], 0) >= ticksUntilArrival)
        .reduce((total, fleet) => total + fleet.st, 0);
}

function rallyAvailableShips(scan: ScanningData, ownFleets: Fleet[], rallyStar: MutableStar, assignedFleetUids: Set<number>) {
    return projectedStarShips(scan, rallyStar, 0) + ownFleets
        .filter((fleet) => fleet.ouid === rallyStar.uid && fleet.o.length === 0 && !assignedFleetUids.has(fleet.uid))
        .reduce((total, fleet) => total + fleet.st, 0);
}

function uniqueStars(stars: MutableStar[]) {
    const seen = new Set<number>();
    const unique: MutableStar[] = [];
    for (const star of stars) {
        if (seen.has(star.uid)) continue;
        seen.add(star.uid);
        unique.push(star);
    }
    return unique;
}

function ownedScannedStars(scan: ScanningData) {
    return Object.values(scan.stars)
        .filter((star): star is ScannedStar => isScanned(star) && star.puid === scan.playerUid);
}

function draftDiplomacy(scan: ScanningData, messages: unknown[]): DiplomacyDraft[] {
    const player = scan.players[String(scan.playerUid)];
    if (!player) return [];

    const attackDrafts = draftAttackObjections(scan, messages);
    const objectedTo = new Set(attackDrafts.map((draft) => draft.recipientUid));
    const techDrafts = neighboringEmpires(scan).flatMap((neighbor) => {
        if (objectedTo.has(neighbor.uid)) return [];
        const history = diplomacyHistoryWith(scan.playerUid, neighbor.uid, messages);
        const friendly = hasFastReply(scan.playerUid, neighbor.uid, history);
        const latestInbound = latestMessageFrom(neighbor.uid, history);
        const latestOutbound = latestMessageFrom(scan.playerUid, history);
        const responding = friendly
            && latestInbound !== undefined
            && (latestOutbound === undefined || latestInbound.created > latestOutbound.created);
        if (history.length > 0 && !responding) {
            return [];
        }
        const research = techName(player.researching);
        const latestInboundBody = responding ? latestInbound.body : undefined;

        const draft: DiplomacyDraft = {
            recipientUid: neighbor.uid,
            recipientAlias: neighbor.alias,
            recipientColor: neighbor.color,
            fromColor: playerColorStyle(player.color),
            friendly,
            subject: responding ? "Re: tech cooperation" : "Tech trading",
            body: diplomacyBody(player.alias, neighbor.alias, research, responding, latestInboundBody),
            reason: responding
                ? `${neighbor.alias} replied within 8h; draft keeps the tech-trade conversation moving`
                : `${neighbor.alias} is a neighboring empire at ${neighbor.distance.toFixed(2)} ly; draft opens with research disclosure and tech-trade cooperation`,
        };
        if (responding) {
            draft.context = threadContext(history, scan.playerUid, neighbor.alias);
        }
        if (responding && latestInbound.threadKey) {
            draft.threadKey = latestInbound.threadKey;
        }
        return [draft];
    });
    return [...attackDrafts, ...techDrafts];
}

function draftAttackObjections(scan: ScanningData, messages: unknown[]): DiplomacyDraft[] {
    const player = scan.players[String(scan.playerUid)];
    if (!player) return [];
    const attacksByPlayer = new Map<number, IncomingAttack[]>();
    const stars = ownedScannedStars(scan).map((star) => ({
        ...star,
        frontierWeight: frontierWeight(scan, star),
    }));
    for (const attack of visibleIncomingAttacks(scan, stars)) {
        const attacks = attacksByPlayer.get(attack.attacker.uid) ?? [];
        attacks.push(attack);
        attacksByPlayer.set(attack.attacker.uid, attacks);
    }

    return [...attacksByPlayer.entries()].flatMap(([attackerUid, attacks]) => {
        const attacker = scan.players[String(attackerUid)];
        if (!attacker) return [];
        const history = diplomacyHistoryWith(scan.playerUid, attackerUid, messages);
        const latestInbound = latestMessageFrom(attackerUid, history);
        const latestOutbound = latestMessageFrom(scan.playerUid, history);
        if (latestOutbound?.body && /attack|attacking|hostile|border violation/i.test(latestOutbound.body)
            && (latestInbound === undefined || latestOutbound.created > latestInbound.created)) {
            return [];
        }

        const worstAttack = [...attacks].sort((a, b) => Number(b.estimate.attackerWins) - Number(a.estimate.attackerWins)
            || b.estimate.additionalDefendersNeeded - a.estimate.additionalDefendersNeeded
            || a.eta - b.eta)[0];
        if (!worstAttack) return [];

        const targetList = attacks
            .map((attack) => `${npLink(attack.target.n)} in ${attack.eta.toFixed(1)} ticks`)
            .join(", ");
        const draft: DiplomacyDraft = {
            recipientUid: attacker.uid,
            recipientAlias: attacker.alias,
            recipientColor: attacker.color,
            fromColor: playerColorStyle(player.color),
            friendly: false,
            subject: "Border violation",
            body: [
                `Hi ${npLink(attacker.alias)}, I can see your fleet movements toward my stars: ${targetList}.`,
                "I object to these attacks. Since carriers already in flight cannot be redirected, please do not reinforce this attack or send follow-up attacks while we discuss compensation and border terms.",
                "If this continues as a wider offensive, I will treat it as hostile action and respond accordingly.",
                `- ${npLink(player.alias)}`,
            ].join("\n\n"),
            reason: `${attacker.alias} has ${attacks.length} visible fleet attack${attacks.length === 1 ? "" : "s"} inbound; draft objects before combat`,
        };
        if (history.length > 0) draft.context = threadContext(history, scan.playerUid, attacker.alias);
        const threadKey = latestInbound?.threadKey ?? latestOutbound?.threadKey;
        if (threadKey) draft.threadKey = threadKey;
        return [draft];
    });
}

function threadContext(history: DiplomacyEvent[], myUid: number, theirAlias: string) {
    return history
        .slice(-6)
        .map((event) => {
            const speaker = event.body
                ? event.fromUid === myUid ? "Us" : theirAlias
                : undefined;
            return speaker ? `${speaker}: ${event.body}` : undefined;
        })
        .filter((line): line is string => Boolean(line))
        .join("\n\n");
}

function playerColorStyle(color: number) {
    const colors = ["#0000ff", "#009fdf", "#40c000", "#ffc000", "#df5f00", "#c00000", "#c000c0", "#6000c0"];
    return colors[color] ?? "#0000ff";
}

function neighboringEmpires(scan: ScanningData) {
    const myStars = Object.values(scan.stars).filter((star) => star.puid === scan.playerUid);
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const maxNeighborDistance = Math.max(range * 3, scan.config.homeStarDistance * 1.5);

    return Object.values(scan.players)
        .filter((player) => player.uid !== scan.playerUid && player.totalStars > 0 && player.conceded === 0)
        .map((player) => ({
            uid: player.uid,
            alias: player.alias,
            color: player.color,
            distance: nearestDistanceBetweenEmpires(myStars, Object.values(scan.stars).filter((star) => star.puid === player.uid)),
        }))
        .filter((neighbor) => Number.isFinite(neighbor.distance) && neighbor.distance <= maxNeighborDistance)
        .sort((a, b) => a.distance - b.distance || a.uid - b.uid);
}

function nearestDistanceBetweenEmpires(ours: Star[], theirs: Star[]) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const ourStar of ours) {
        for (const theirStar of theirs) {
            nearest = Math.min(nearest, starDistance(ourStar, theirStar));
        }
    }
    return nearest;
}

function nearestDistanceToStars(source: Star, targets: Star[]) {
    return targets.reduce((nearest, target) => Math.min(nearest, starDistance(source, target)), Number.POSITIVE_INFINITY);
}

function activePlayer(scan: ScanningData, playerUid: number) {
    const player = scan.players[String(playerUid)];
    return player !== undefined && player.totalStars > 0 && player.conceded === 0;
}

function diplomacyHistoryWith(myUid: number, theirUid: number, messages: unknown[]) {
    return messages
        .flatMap((message) => messageEvents(message, myUid, theirUid))
        .filter((event) => event.fromUid === myUid || event.fromUid === theirUid)
        .filter((event) => event.toUids.includes(myUid) || event.toUids.includes(theirUid))
        .filter((event) => event.fromUid !== myUid || event.toUids.includes(theirUid))
        .filter((event) => event.fromUid !== theirUid || event.toUids.includes(myUid))
        .sort((a, b) => a.created - b.created);
}

function messageEvents(message: unknown, myUid: number, theirUid: number) {
    const root = message as DiplomacyMessage;
    const threadKey = messageKey(message);
    const events = [messageEvent(root)]
        .filter((event): event is ReturnType<typeof messageEvent> & { created: number; fromUid: number; toUids: number[] } => Boolean(event));
    for (const comment of root.comments ?? []) {
        const event = commentEvent(comment, myUid, theirUid);
        if (event) events.push(event);
    }
    return events.map((event) => {
        const withThread: DiplomacyEvent = event;
        if (threadKey) withThread.threadKey = threadKey;
        return withThread;
    });
}

function messageEvent(message: DiplomacyMessage) {
    const created = timestampMs(message.payload?.created ?? message.created);
    const fromUid = numeric(message.payload?.from_uid ?? message.player_uid);
    const toUids = numericArray(message.payload?.to_uids);
    if (created === undefined || fromUid === undefined) return undefined;
    return diplomacyEvent(created, fromUid, toUids, stringValue(message.payload?.body));
}

function commentEvent(comment: DiplomacyComment, myUid: number, theirUid: number) {
    const created = timestampMs(comment.payload?.created ?? comment.created);
    const fromUid = numeric(comment.payload?.senderUid ?? comment.payload?.from_uid ?? comment.player_uid);
    if (created === undefined || fromUid === undefined) return undefined;
    const toUids = fromUid === myUid
        ? [theirUid]
        : fromUid === theirUid
            ? [myUid]
            : [];
    return diplomacyEvent(created, fromUid, toUids, stringValue(comment.payload?.body));
}

function diplomacyEvent(created: number, fromUid: number, toUids: number[], body?: string): DiplomacyEvent {
    const event: DiplomacyEvent = { created, fromUid, toUids };
    if (body) event.body = body;
    return event;
}

function hasFastReply(myUid: number, theirUid: number, history: DiplomacyEvent[]) {
    for (const outbound of history.filter((event) => event.fromUid === myUid)) {
        const reply = history.find((event) => event.fromUid === theirUid && event.created > outbound.created);
        if (reply && reply.created - outbound.created <= 8 * 60 * 60 * 1000) {
            return true;
        }
    }
    return false;
}

function latestMessageFrom(uid: number, history: DiplomacyEvent[]) {
    return [...history].reverse().find((event) => event.fromUid === uid);
}

function diplomacyBody(myAlias: string, theirAlias: string, research: string, responding: boolean, latestInboundBody?: string) {
    if (responding && latestInboundBody) {
        const wantsManufacturing = /manufacturing/i.test(latestInboundBody);
        const asksWeapons = /weapons/i.test(latestInboundBody);
        const specifics = wantsManufacturing || asksWeapons
            ? "Your proposal makes sense: you focus Manufacturing, I will continue Weapons, and we can exchange when each completes."
            : "Your proposal makes sense; we can coordinate research paths and exchange finished techs when they are ready.";
        return [
            `Hi ${npLink(theirAlias)}, thanks for the quick reply.`,
            specifics,
            `I am currently researching ${research}, so I will keep that on track.`,
            "Please send Manufacturing when it completes, and I will reciprocate with Weapons as soon as it is available.",
            `- ${npLink(myAlias)}`,
        ].join("\n\n");
    }

    const opener = responding
        ? `Hi ${npLink(theirAlias)}, thanks for the quick reply.`
        : `Hi ${npLink(theirAlias)}, it looks like we are going to be neighbors.`;
    return [
        opener,
        `I am currently researching ${research}.`,
        "I would like to coordinate tech trades where it is mutually profitable, especially when we can avoid duplicating research and both accelerate our starts.",
        "Let me know what you are researching and what trades you would be open to lining up.",
        `- ${npLink(myAlias)}`,
    ].join("\n\n");
}

function npLink(name: string) {
    return name.startsWith("[[") && name.endsWith("]]") ? name : `[[${name}]]`;
}

function techName(kind: number) {
    const names: Record<number, string> = {
        [TECH.BANKING]: "Banking",
        [TECH.RESEARCH]: "Experimentation",
        [TECH.MANUFACTURING]: "Manufacturing",
        [TECH.PROPULSION]: "Propulsion",
        [TECH.SCANNING]: "Scanning",
        [TECH.WEAPONS]: "Weapons",
        [TECH.TERRAFORMING]: "Terraforming",
    };
    return names[kind] ?? `technology ${kind}`;
}

function timestampMs(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) return numericValue;
    }
    if (value instanceof Date) return value.getTime();
    return undefined;
}

function numeric(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function numericArray(value: unknown) {
    if (Array.isArray(value)) {
        return value.map(numeric).filter((entry): entry is number => entry !== undefined);
    }
    if (typeof value === "string") {
        return value.split(",").map(numeric).filter((entry): entry is number => entry !== undefined);
    }
    return [];
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
}

function messageKey(message: unknown) {
    if (!message || typeof message !== "object") return undefined;
    const key = (message as { key?: unknown }).key;
    return typeof key === "string" ? key : undefined;
}

function reachableNeutralTargets(
    scan: ScanningData,
    stars: MutableStar[],
    range: number,
    speed: number,
    expansionHorizonTicks: number,
): NeutralTarget[] {
    return Object.values(scan.stars)
        .filter(isNeutralStar)
        .map((star) => ({
            star,
            nearestOwnedDistance: nearestOwnedDistance(stars, star),
        }))
        .filter((target) => target.nearestOwnedDistance <= range && etaTicks(target.nearestOwnedDistance, speed) <= expansionHorizonTicks)
        .sort((a, b) => a.nearestOwnedDistance - b.nearestOwnedDistance || a.star.uid - b.star.uid);
}

function isNeutralStar(star: Star) {
    return star.puid <= 0;
}

function nearestReachableNeutralForFleet(
    scan: ScanningData,
    fleet: Fleet,
    targets: NeutralTarget[],
    assignedTargets: Set<number>,
    range: number,
    expansionHorizonTicks: number,
) {
    const origin = scan.stars[String(fleet.ouid)];
    if (!origin) return undefined;
    return targets
        .filter((target) => !assignedTargets.has(target.star.uid))
        .map((target) => {
            const distance = starDistance(origin, target.star);
            const speed = Math.max(fleet.speed || scan.fleetSpeed, 0.0001);
            return {
                star: target.star,
                distance,
                eta: etaTicks(distance, speed),
            };
        })
        .filter((target) => target.distance <= range && target.eta <= expansionHorizonTicks)
        .sort((a, b) => a.eta - b.eta || a.distance - b.distance || a.star.uid - b.star.uid)[0];
}

function bestCarrierSource(
    stars: MutableStar[],
    sourceShips: Map<number, number>,
    target: Star,
    range: number,
    speed: number,
    expansionHorizonTicks: number,
) {
    return stars
        .filter((star) => (sourceShips.get(star.uid) ?? 0) > 0)
        .map((source) => {
            const distance = starDistance(source, target);
            return {
                source,
                distance,
                eta: etaTicks(distance, speed),
            };
        })
        .filter((candidate) => candidate.distance <= range && candidate.eta <= expansionHorizonTicks)
        .sort((a, b) => a.eta - b.eta || a.distance - b.distance || b.source.st - a.source.st)[0];
}

function nearestOwnedDistance(stars: MutableStar[], target: Star) {
    return stars.reduce((nearest, star) => Math.min(nearest, starDistance(star, target)), Number.POSITIVE_INFINITY);
}

function expansionHorizon(scan: ScanningData) {
    return Math.max(1, scan.productionRate);
}

function etaTicks(distance: number, speed: number) {
    return distance / Math.max(speed, 0.0001);
}

function carrierCostFor(config: GameConfig, buildIndex: number) {
    return config.fleetCost + config.fleetInc * buildIndex;
}

function frontierWeight(scan: ScanningData, star: ScannedStar) {
    let nearestOther = Number.POSITIVE_INFINITY;
    for (const other of Object.values(scan.stars)) {
        if (other.uid === star.uid || other.puid === scan.playerUid) continue;
        nearestOther = Math.min(nearestOther, starDistance(star, other));
    }
    if (!Number.isFinite(nearestOther)) return 1;
    return 1 + 1 / Math.max(0.1, nearestOther);
}

function isScanned(star: Star): star is ScannedStar {
    return (star as { v: unknown }).v === 1 || (star as { v: unknown }).v === "1";
}

function starDistance(a: Pick<Star, "x" | "y">, b: Pick<Star, "x" | "y">) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function economyCostFor(config: GameConfig, star: ScannedStar) {
    return Math.floor((2.5 * (star.e + 1) * config.devCostEco) / (star.r / 100));
}

function industryCostFor(config: GameConfig, star: ScannedStar) {
    return Math.floor((5 * (star.i + 1) * config.devCostInd) / (star.r / 100));
}

function scienceCostFor(config: GameConfig, star: ScannedStar) {
    return Math.floor((20 * (star.s + 1) * config.devCostSci) / (star.r / 100));
}

function techLevel(player: Player, kind: number) {
    return safeNumber((player.tech[String(kind)] as TechInfo | undefined)?.level, 1);
}

function rangeValue(player: Player | undefined) {
    if (!player) return 0;
    return 0.5 + techLevel(player, TECH.PROPULSION) * 0.125;
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
