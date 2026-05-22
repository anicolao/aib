import type { Fleet, GameConfig, Player, ScannedStar, ScanningData, Star, TechInfo } from "./types.js";
import type { PlannedCommand } from "./command.js";
import { estimateBattle, estimateStarBattle, projectedStarShips, type BattleEstimate } from "./battle.js";

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
        techTransfersPlanned: number;
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
    skipFlavor?: boolean;
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
    utility: number;
    key: string;
}

interface InfraPurchase {
    kind: InfraKind;
    starUid: number;
    starName: string;
    cost: number;
    utility: number;
    score: number;
}

interface InfraOptimizationPlan {
    purchases: InfraPurchase[];
    cashRemaining: number;
    utility: number;
    explored: number;
    pruned: number;
}

interface CarrierPlan {
    buildCount: number;
    buildCost: number;
    budget: number;
}

interface CarrierFleetAssignment {
    fleet: Fleet;
    source: MutableStar;
    target: Star;
    eta: number;
    loadShips: number;
    departureShips: number;
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
    ships: number;
}

interface CarrierExecution {
    cash: number;
    builtCount: number;
}

interface DefensiveCarrierAssignment {
    mode: "defend" | "counterattack";
    source: MutableStar;
    target: MutableStar;
    attack: IncomingAttack;
    ships: number;
    eta: number;
    cost: number;
}

interface DefensiveCarrierPlan {
    assignments: DefensiveCarrierAssignment[];
    buildCount: number;
    buildCost: number;
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
    role: "attack" | "defend" | "rally" | "supply";
    reason: string;
}

interface SupplyShuttleAssignment {
    fleet: Fleet;
    source: MutableStar;
    target: MutableStar;
    eta: number;
    score: number;
}

interface ReturnCarrierAssignment {
    fleet: Fleet;
    source: MutableStar;
    target: MutableStar;
    eta: number;
    dropShips: number;
    targetAvailableShips: number;
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
        attackerWeapons: number;
        defenderWeapons: number;
        attackerWins: boolean;
        attackerRemaining: number;
        defenderRemaining: number;
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

interface GameEvent {
    payload?: {
        template?: unknown;
        tick?: unknown;
        from_puid?: unknown;
        to_puid?: unknown;
        tech?: unknown;
        name?: unknown;
        level?: unknown;
        attackers?: unknown;
        defenders?: unknown;
    };
}

interface SharedTechnologyEvent {
    tick: number;
    fromUid: number;
    toUid: number;
    techKind: number;
    level: number;
}

interface TechTransferPlan {
    commands: PlannedCommand[];
    diplomacyDrafts: DiplomacyDraft[];
    reserveCost: number;
}

interface TechTradeDecision {
    techKind: number;
    reason: string;
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

const FLEET_ORDER = {
    NOTHING: 0,
    COLLECT_ALL: 1,
    DROP_ALL: 2,
    COLLECT: 3,
    DROP: 4,
    COLLECT_ALL_BUT: 5,
    DROP_ALL_BUT: 6,
    GARRISON: 7,
} as const;

const NEUTRAL_CAPTURE_SHIPS = 5;
const EXPANSION_SOURCE_GARRISON = 1;

export function planTurn(
    scan: ScanningData,
    config: PlannerConfig,
    dryRun: boolean,
    diplomacyMessages: unknown[] = [],
    gameEvents: unknown[] = [],
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
    const tacticalPlan = planTactics(scan, stars, ownFleets, config, rejected);
    const tacticalFleetUids = new Set(tacticalPlan.assignments.map((assignment) => assignment.fleet.uid));
    const techTransferPlan = planTechTransfers(scan, diplomacyMessages, gameEvents, tacticalPlan);
    const defensiveCarrierPlan = config.buildCarrier
        ? planDefensiveCarrierBuilds(scan, stars, tacticalPlan, safeNumber(player.cash, 0), techTransferPlan.reserveCost, 0, config.horizonTicks, rejected)
        : { assignments: [], buildCount: 0, buildCost: 0 };
    const mandatoryReserve = Math.max(
        Math.floor(safeNumber(player.cash, 0) * config.cashReserveRatio),
        techTransferPlan.reserveCost + defensiveCarrierPlan.buildCost,
    );
    const carrierBudget = config.buildCarrier
        ? logisticsBudget(scan, player, stars, safeNumber(player.cash, 0), mandatoryReserve, config)
        : 0;
    const carrierPlan = config.buildCarrier
        ? planCarrierCoverage(scan, stars, ownFleets, tacticalFleetUids, carrierBudget, config.horizonTicks, defensiveCarrierPlan.buildCount, rejected)
        : { buildCount: 0, buildCost: 0, budget: 0 };

    let cash = safeNumber(player.cash, 0);
    const reserve = Math.max(
        mandatoryReserve,
        defensiveCarrierPlan.buildCost + carrierPlan.buildCost + techTransferPlan.reserveCost,
    );
    cash = buyInfrastructure(scan, player, stars, cash, reserve, config, commands, rejected);

    commands.push(...techTransferPlan.commands);
    cash -= techTransferPlan.reserveCost;

    executeTacticalRoutes(tacticalPlan, commands);

    let builtCarriersThisTurn = 0;
    if (config.buildCarrier) {
        const defenseExecution = executeDefensiveCarrierBuilds(defensiveCarrierPlan, cash, commands, rejected);
        cash = defenseExecution.cash;
        builtCarriersThisTurn += defenseExecution.builtCount;
        const carrierExecution = executeCarrierCoverage(scan, stars, ownFleets, tacticalFleetUids, cash, carrierPlan.budget, config.horizonTicks, builtCarriersThisTurn, commands, rejected);
        cash = carrierExecution.cash;
        builtCarriersThisTurn += carrierExecution.builtCount;
        executeSupplyShuttles(scan, stars, ownFleets, tacticalFleetUids, config.horizonTicks, commands, rejected);
        executeReturnCarriers(scan, stars, ownFleets, tacticalFleetUids, config.horizonTicks, commands, rejected);
        const stagingExecution = executeShipStaging(scan, stars, cash, builtCarriersThisTurn, carrierPlan.budget - carrierExecution.spent, commands, rejected);
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

    const techDraftRecipients = new Set(techTransferPlan.diplomacyDrafts.map((draft) => draft.recipientUid));
    const diplomacyDrafts = [
        ...techTransferPlan.diplomacyDrafts,
        ...draftDiplomacy(scan, diplomacyMessages, techDraftRecipients),
    ];

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
            techTransfersPlanned: techTransferPlan.commands.length,
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
    const plan = optimizeInfrastructure(scan, player, stars, cashStart, reserve, plannerConfig);
    if (plan.purchases.length === 0) {
        const spendable = cashStart - reserve;
        rejected.push(spendable <= 0
            ? `stopped infrastructure purchases with $${cashStart}; reserve is $${reserve}`
            : `stopped infrastructure; optimizer found no positive-utility purchase within spendable budget $${spendable}`);
        return cashStart;
    }

    for (const purchase of plan.purchases) {
        const star = stars.find((candidate) => candidate.uid === purchase.starUid);
        if (star) {
            applyInfraPurchase({ ...purchase, star, key: "", score: purchase.score });
        }
        commands.push({
            kind: "batched_order",
            order: `upgrade_${purchase.kind},${purchase.starUid},${purchase.cost}`,
            reason: `${purchase.kind} at ${purchase.starName} selected by 30-tick optimizer; utility ${purchase.utility.toFixed(2)}, score ${purchase.score.toFixed(4)}`,
        });
    }

    rejected.push(
        `infrastructure optimizer explored ${plan.explored} nodes and pruned ${plan.pruned}; selected ${plan.purchases.length} purchases with utility ${plan.utility.toFixed(2)}`,
    );
    return plan.cashRemaining;
}

function optimizeInfrastructure(
    scan: ScanningData,
    player: Player,
    stars: MutableStar[],
    cashStart: number,
    reserve: number,
    plannerConfig: PlannerConfig,
): InfraOptimizationPlan {
    const spendable = cashStart - reserve;
    if (spendable <= 0) {
        return { purchases: [], cashRemaining: cashStart, utility: 0, explored: 0, pruned: 0 };
    }

    const maxDepth = Math.min(18, Math.max(4, stars.length * 3));
    const maxNodes = 25000;
    let explored = 0;
    let pruned = 0;
    let best: InfraOptimizationPlan = {
        purchases: [],
        cashRemaining: cashStart,
        utility: 0,
        explored: 0,
        pruned: 0,
    };

    const search = (stateStars: MutableStar[], cash: number, purchases: InfraPurchase[], utility: number) => {
        explored += 1;
        if (utility > best.utility || (utility === best.utility && cash > best.cashRemaining)) {
            best = {
                purchases: [...purchases],
                cashRemaining: cash,
                utility,
                explored,
                pruned,
            };
        }
        if (explored >= maxNodes || purchases.length >= maxDepth) return;

        const candidates = infraCandidates(scan, player, stateStars, cash - reserve, plannerConfig)
            .filter((candidate) => candidate.utility > 0)
            .slice(0, 12);
        if (candidates.length === 0) return;

        const optimistic = utility + candidates.reduce((total, candidate) => total + Math.max(0, candidate.utility), 0);
        if (optimistic <= best.utility) {
            pruned += 1;
            return;
        }

        for (const candidate of candidates) {
            const nextStars = cloneMutableStars(stateStars);
            const nextStar = nextStars.find((star) => star.uid === candidate.star.uid);
            if (!nextStar) continue;
            const nextCandidate: InfraCandidate = { ...candidate, star: nextStar };
            applyInfraPurchase(nextCandidate);
            search(nextStars, cash - candidate.cost, [
                ...purchases,
                {
                    kind: candidate.kind,
                    starUid: candidate.star.uid,
                    starName: candidate.star.n,
                    cost: candidate.cost,
                    utility: candidate.utility,
                    score: candidate.score,
                },
            ], utility + candidate.utility);
        }
    };

    search(cloneMutableStars(stars), cashStart, [], 0);
    return { ...best, explored, pruned };
}

function infraCandidates(
    scan: ScanningData,
    player: Player,
    stars: MutableStar[],
    spendable: number,
    plannerConfig: PlannerConfig,
) {
    const gameConfig = scan.config;
    const candidates: InfraCandidate[] = [];
    const productionCycles = productionEventsWithin(scan, plannerConfig.horizonTicks);
    const manufacturing = techLevel(player, TECH.MANUFACTURING);
    const buyEconomy = crossesProductionBoundaryNextTurn(scan);

    for (const star of stars) {
        const ecoCost = economyCostFor(gameConfig, star);
        if (buyEconomy && ecoCost <= spendable) {
            const utility = productionCycles * 10 - ecoCost * 0.04;
            candidates.push({
                kind: "economy",
                star,
                cost: ecoCost,
                utility,
                score: utility / ecoCost,
                key: infraCandidateKey("economy", star),
            });
        }

        if (buyEconomy) {
            continue;
        }

        const industryCost = industryCostFor(gameConfig, star);
        if (industryCost <= spendable && belowIndustryCapAfterPurchase(star)) {
            const shipsByHorizon = productionCycles * (manufacturing + 4);
            const utility = shipsByHorizon * star.frontierWeight * 11 - industryCost * 0.04;
            candidates.push({
                kind: "industry",
                star,
                cost: industryCost,
                utility,
                score: utility / industryCost,
                key: infraCandidateKey("industry", star),
            });
        }

        const scienceCost = scienceCostFor(gameConfig, star);
        if (scienceCost <= spendable && belowScienceCapAfterPurchase(star)) {
            const scienceNeed = Math.max(0.75, player.totalIndustry / Math.max(1, player.totalScience * 2));
            const utility = scienceNeed * plannerConfig.horizonTicks * 3 - scienceCost * 0.035;
            candidates.push({
                kind: "science",
                star,
                cost: scienceCost,
                utility,
                score: utility / scienceCost,
                key: infraCandidateKey("science", star),
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score || b.utility - a.utility || a.cost - b.cost || a.key.localeCompare(b.key));
    return candidates;
}

function cloneMutableStars(stars: MutableStar[]) {
    return stars.map((star) => ({ ...star }));
}

function infraCandidateKey(kind: InfraKind, star: MutableStar) {
    return `${kind}:${star.uid}`;
}

function productionEventsWithin(scan: ScanningData, horizonTicks: number) {
    return Math.floor((scan.productionCounter + Math.max(0, horizonTicks)) / Math.max(1, scan.productionRate));
}

function logisticsBudget(
    scan: ScanningData,
    player: Player,
    stars: MutableStar[],
    cash: number,
    mandatoryReserve: number,
    plannerConfig: PlannerConfig,
) {
    const afterReserve = Math.max(0, cash - mandatoryReserve);
    if (afterReserve <= 0) return 0;
    const bestInfraCost = infraCandidates(scan, player, cloneMutableStars(stars), afterReserve, plannerConfig)[0]?.cost ?? 0;
    const minimumInfraBudget = bestInfraCost > 0 ? bestInfraCost : Math.floor(afterReserve * 0.5);
    const outsideEmergencyCap = Math.floor(afterReserve * 0.25);
    return Math.max(0, Math.min(outsideEmergencyCap, afterReserve - minimumInfraBudget));
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

function planTechTransfers(
    scan: ScanningData,
    diplomacyMessages: unknown[],
    gameEvents: unknown[],
    tacticalPlan: TacticalPlan,
): TechTransferPlan {
    const player = scan.players[String(scan.playerUid)];
    if (!player) return { commands: [], diplomacyDrafts: [], reserveCost: 0 };

    const commands: PlannedCommand[] = [];
    const diplomacyDrafts: DiplomacyDraft[] = [];
    let reserveCost = 0;
    const incomingAttackerUids = new Set(tacticalPlan.incomingAttacks.map((attack) => attack.attacker.uid));
    const alreadyHandled = new Set<number>();

    for (const receipt of receivedTechEvents(scan, gameEvents)) {
        if (alreadyHandled.has(receipt.fromUid)) continue;
        const sender = scan.players[String(receipt.fromUid)];
        if (!sender) continue;

        const history = diplomacyHistoryWith(scan.playerUid, receipt.fromUid, diplomacyMessages);
        const threadKey = latestMessageFrom(receipt.fromUid, history)?.threadKey
            ?? latestMessageFrom(scan.playerUid, history)?.threadKey;
        const aggr = aggressionStatus(scan, receipt.fromUid, gameEvents, incomingAttackerUids);

        if (aggr.incoming) {
            if (alreadySentTechRefusal(history, scan.playerUid, receipt, "incoming")) {
                alreadyHandled.add(receipt.fromUid);
                continue;
            }
            diplomacyDrafts.push(techTradeDiplomacyDraft(
                scan,
                sender,
                "Tech and an attack",
                [
                    `[[${sender.alias}]], I received your ${techName(receipt.techKind)} transfer.`,
                    "Sending technology with one hand while attacking with the other is not cooperation.",
                    "I will not reciprocate while your fleets are inbound. End the attack first, then we can discuss whether trust can be rebuilt.",
                    `- [[${player.alias}]]`,
                ].join("\n\n"),
                "incoming attack blocks reciprocal tech transfer",
                history,
                threadKey,
            ));
            alreadyHandled.add(receipt.fromUid);
            continue;
        }

        if (aggr.anyPast) {
            if (alreadySentTechRefusal(history, scan.playerUid, receipt, "past")) {
                alreadyHandled.add(receipt.fromUid);
                continue;
            }
            diplomacyDrafts.push(techTradeDiplomacyDraft(
                scan,
                sender,
                "Tech trade paused",
                [
                    `[[${sender.alias}]], I received your ${techName(receipt.techKind)} transfer.`,
                    "Because there has already been combat between us, I am not sending technology back immediately.",
                    "Maintain a longer period of peace and we can revisit tech trading once the border is demonstrably stable.",
                    `- [[${player.alias}]]`,
                ].join("\n\n"),
                "past aggression blocks reciprocal tech transfer until longer peace",
                history,
                threadKey,
            ));
            alreadyHandled.add(receipt.fromUid);
            continue;
        }

        const tradeDecision = agreedTechToSend(scan, sender, receipt, history);
        if (!tradeDecision) continue;
        const senderTech = sender.tech[String(tradeDecision.techKind)] as TechInfo | undefined;
        const senderLevel = safeNumber(senderTech?.level, 0);
        const nextLevel = senderLevel + 1;
        const ourLevel = techLevel(player, tradeDecision.techKind);
        if (nextLevel !== receipt.level || ourLevel < nextLevel) continue;

        const cost = techTradeCost(scan, nextLevel);
        if (safeNumber(player.cash, 0) - reserveCost < cost) continue;
        commands.push({
            kind: "tech_transfer",
            order: `share_tech,${sender.uid},${tradeDecision.techKind}`,
            reason: `reciprocate ${techName(receipt.techKind)} level ${receipt.level} from ${sender.alias} with ${techName(tradeDecision.techKind)} level ${nextLevel}; ${tradeDecision.reason}`,
        });
        reserveCost += cost;
        alreadyHandled.add(receipt.fromUid);
    }

    return { commands, diplomacyDrafts, reserveCost };
}

function receivedTechEvents(scan: ScanningData, gameEvents: unknown[]): SharedTechnologyEvent[] {
    const outbound = sentTechEvents(scan, gameEvents);
    return sharedTechEvents(gameEvents)
        .filter((event) => event.toUid === scan.playerUid && event.fromUid !== scan.playerUid)
        .filter((event) => !outbound.some((sent) => sent.toUid === event.fromUid && sent.tick >= event.tick))
        .sort((a, b) => b.tick - a.tick || b.level - a.level);
}

function sentTechEvents(scan: ScanningData, gameEvents: unknown[]) {
    return sharedTechEvents(gameEvents)
        .filter((event) => event.fromUid === scan.playerUid);
}

function sharedTechEvents(gameEvents: unknown[]): SharedTechnologyEvent[] {
    return gameEvents
        .map((event) => {
            const payload = (event as GameEvent).payload;
            if (payload?.template !== "shared_technology") return undefined;
            const tick = numeric(payload.tick);
            const fromUid = numeric(payload.from_puid);
            const toUid = numeric(payload.to_puid);
            const techKind = techKindValue(payload.tech ?? payload.name);
            const level = numeric(payload.level);
            if (tick === undefined || fromUid === undefined || toUid === undefined || techKind === undefined || level === undefined) {
                return undefined;
            }
            return { tick, fromUid, toUid, techKind, level };
        })
        .filter((event): event is SharedTechnologyEvent => Boolean(event));
}

function aggressionStatus(
    scan: ScanningData,
    otherUid: number,
    gameEvents: unknown[],
    incomingAttackerUids: Set<number>,
) {
    const aggressionTicks = gameEvents
        .map((event) => aggressionTickAgainstUs(scan, otherUid, event))
        .filter((tick): tick is number => tick !== undefined);
    return {
        incoming: incomingAttackerUids.has(otherUid),
        recent: aggressionTicks.some((tick) => scan.tick - tick <= 30),
        anyPast: aggressionTicks.length > 0,
    };
}

function aggressionTickAgainstUs(scan: ScanningData, otherUid: number, event: unknown) {
    const payload = (event as GameEvent).payload;
    if (payload?.template !== "combat_mk_ii") return undefined;
    const tick = numeric(payload.tick);
    if (tick === undefined) return undefined;
    if (combatantsInclude(payload.attackers, otherUid) && combatantsInclude(payload.defenders, scan.playerUid)) {
        return tick;
    }
    return undefined;
}

function combatantsInclude(value: unknown, uid: number) {
    if (!value || typeof value !== "object") return false;
    return Object.values(value as Record<string, unknown>).some((entry) => {
        if (!entry || typeof entry !== "object") return false;
        return numeric((entry as { puid?: unknown }).puid) === uid;
    });
}

function agreedTechToSend(
    scan: ScanningData,
    sender: Player,
    receipt: SharedTechnologyEvent,
    history: DiplomacyEvent[],
): TechTradeDecision | undefined {
    const text = history.map((event) => event.body ?? "").join("\n").toLowerCase();
    const requested = requestedTechKinds(text);
    for (const techKind of requested) {
        if (canSendEquivalentLevel(scan, sender, techKind, receipt.level)) {
            return { techKind, reason: "thread names this technology as our side of the trade" };
        }
    }
    return undefined;
}

function requestedTechKinds(text: string) {
    const kinds: number[] = [];
    for (const [kind, aliases] of techAliases()) {
        if (aliases.some((alias) => text.includes(alias))) {
            kinds.push(kind);
        }
    }
    return kinds;
}

function canSendEquivalentLevel(scan: ScanningData, recipient: Player, techKind: number, level: number) {
    const player = scan.players[String(scan.playerUid)];
    if (!player) return false;
    const recipientLevel = safeNumber((recipient.tech[String(techKind)] as TechInfo | undefined)?.level, 0);
    return recipientLevel + 1 === level && techLevel(player, techKind) >= level;
}

function alreadySentTechRefusal(history: DiplomacyEvent[], myUid: number, receipt: SharedTechnologyEvent, kind: "incoming" | "past") {
    const tech = techName(receipt.techKind);
    return history.some((event) => {
        if (event.fromUid !== myUid || !event.body) return false;
        const body = event.body.toLowerCase();
        const mentionsReceipt = body.includes(tech.toLowerCase())
            || body.includes("technology")
            || body.includes("tech");
        if (!mentionsReceipt) return false;
        if (kind === "incoming") {
            return body.includes("not reciprocate")
                || body.includes("not sending")
                || body.includes("tech-receipt-hold")
                || body.includes("while your fleets are inbound")
                || body.includes("attacking with the other")
                || body.includes("trust can be rebuilt");
        }
        return body.includes("not sending")
            || body.includes("tech-receipt-hold")
            || body.includes("longer period of peace")
            || body.includes("revisit tech trading")
            || body.includes("combat between us")
            || (body.includes("peace") && body.includes("trade"));
    });
}

function techTradeDiplomacyDraft(
    scan: ScanningData,
    recipient: Player,
    subject: string,
    body: string,
    reason: string,
    history: DiplomacyEvent[],
    threadKey?: string,
): DiplomacyDraft {
    const player = scan.players[String(scan.playerUid)];
    const draft: DiplomacyDraft = {
        recipientUid: recipient.uid,
        recipientAlias: recipient.alias,
        recipientColor: recipient.color,
        fromColor: playerColorStyle(player?.color ?? 0),
        friendly: false,
        subject,
        body,
        reason,
        skipFlavor: true,
    };
    if (history.length > 0) draft.context = threadContext(history, scan.playerUid, recipient.alias);
    if (threadKey) draft.threadKey = threadKey;
    return draft;
}

function techTradeCost(scan: ScanningData, level: number) {
    return Math.floor(level * scan.config.tradeCost);
}

function planTactics(
    scan: ScanningData,
    stars: MutableStar[],
    ownFleets: Fleet[],
    config: PlannerConfig,
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

    const rallyPlan = chooseRallyPlan(scan, stars, ownFleets, assignedFleetUids, config.horizonTicks);
    const rallyAssignments = rallyPlan
        ? assignRallyReinforcements(scan, ownFleets, rallyPlan, assignedFleetUids, config.horizonTicks)
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
            attackerWeapons: attack.estimate.attackerWeapons,
            defenderWeapons: attack.estimate.defenderWeapons,
            attackerWins: attack.estimate.attackerWins,
            attackerRemaining: attack.estimate.attackerRemaining,
            defenderRemaining: attack.estimate.defenderRemaining,
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

function planCarrierCoverage(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    budget: number,
    horizonTicks: number,
    builtCarriersThisTurn: number,
    rejected: string[],
): CarrierPlan {
    const { newCarrierAssignments } = assignCarrierCoverage(scan, stars, fleets, unavailableFleetUids, budget, horizonTicks, builtCarriersThisTurn, rejected);
    return {
        buildCount: newCarrierAssignments.length,
        buildCost: newCarrierAssignments.reduce((total, _assignment, index) => total + carrierCostFor(scan.config, builtCarriersThisTurn + index), 0),
        budget,
    };
}

function executeCarrierCoverage(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    cashStart: number,
    budget: number,
    horizonTicks: number,
    builtCarriersThisTurn: number,
    commands: PlannedCommand[],
    rejected: string[],
) {
    let cash = cashStart;
    const { fleetAssignments, newCarrierAssignments, uncoveredNeutralTargets } = assignCarrierCoverage(scan, stars, fleets, unavailableFleetUids, budget, horizonTicks, builtCarriersThisTurn, rejected);

    for (const assignment of fleetAssignments) {
        unavailableFleetUids.add(assignment.fleet.uid);
        assignment.source.st -= assignment.loadShips;
        const action = assignment.loadShips > 0 ? FLEET_ORDER.COLLECT : FLEET_ORDER.NOTHING;
        commands.push({
            kind: "fleet_order",
            order: `add_fleet_orders,${assignment.fleet.uid},0,${assignment.target.uid},${action},${assignment.loadShips},0`,
            reason: assignment.loadShips > 0
                ? `idle carrier ${assignment.fleet.uid} loads ${assignment.loadShips} ships at ${assignment.source.n} and routes to neutral ${assignment.target.n} (NR ${territoryValue(assignment.target)}) with ${assignment.departureShips} ships; eta ${assignment.eta.toFixed(1)} ticks within expansion horizon`
                : `idle carrier ${assignment.fleet.uid} routed to neutral ${assignment.target.n} (NR ${territoryValue(assignment.target)}) with ${assignment.departureShips} ships; eta ${assignment.eta.toFixed(1)} ticks within expansion horizon`,
        });
    }

    let built = 0;
    let spent = 0;
    for (const assignment of newCarrierAssignments) {
        const cost = carrierCostFor(scan.config, builtCarriersThisTurn + built);
        if (spent + cost > budget) {
            rejected.push(`carrier budget $${budget} blocked carrier for ${assignment.target.n}; would spend $${spent + cost}`);
            continue;
        }
        if (cash < cost) {
            rejected.push(`not enough cash to build carrier for ${assignment.target.n}: $${cash} < $${cost}`);
            continue;
        }
        cash -= cost;
        spent += cost;
        built += 1;
        assignment.source.st -= assignment.ships;
        const command: PlannedCommand = {
            kind: "new_fleet",
            order: `new_fleet,${assignment.source.uid},${assignment.ships}`,
            reason: `build carrier at ${assignment.source.n} with ${assignment.ships} ships for neutral ${assignment.target.n} (NR ${territoryValue(assignment.target)}); eta ${assignment.eta.toFixed(1)} ticks within expansion horizon`,
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

    return { cash, builtCount: built, spent };
}

function executeSupplyShuttles(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    horizonTicks: number,
    commands: PlannedCommand[],
    rejected: string[],
) {
    const assignments = assignSupplyShuttles(scan, stars, fleets, unavailableFleetUids, horizonTicks);
    for (const assignment of assignments) {
        unavailableFleetUids.add(assignment.fleet.uid);
        commands.push({
            kind: "fleet_order",
            order: `add_fleet_orders,${assignment.fleet.uid},0,${assignment.target.uid},0,0,0`,
            reason: `supply shuttle carrier ${assignment.fleet.uid} moves ${assignment.fleet.st} ships from ${assignment.source.n} toward frontier ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} ticks, score ${assignment.score.toFixed(2)}`,
        });
    }
    if (assignments.length === 0) {
        rejected.push("no idle carrier supply shuttle found from core surplus stars to higher-value frontier stars");
    }
}

function assignSupplyShuttles(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    horizonTicks: number,
) {
    const assignments: SupplyShuttleAssignment[] = [];
    const assignedTargets = new Set<number>();
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    for (const fleet of idleOrbitingFleets(fleets, unavailableFleetUids).filter((fleet) => fleet.st >= NEUTRAL_CAPTURE_SHIPS)) {
        const source = stars.find((star) => star.uid === fleet.ouid);
        if (!source) continue;
        const assignment = bestSupplyShuttle(scan, stars, source, fleet, assignedTargets, range, horizonTicks);
        if (!assignment) continue;
        assignedTargets.add(assignment.target.uid);
        assignments.push(assignment);
    }
    return assignments;
}

function bestSupplyShuttle(
    scan: ScanningData,
    stars: MutableStar[],
    source: MutableStar,
    fleet: Fleet,
    assignedTargets: Set<number>,
    range: number,
    horizonTicks: number,
): SupplyShuttleAssignment | undefined {
    const sourceScore = frontierSupplyScore(scan, source);
    return stars
        .filter((target) => target.uid !== source.uid && !assignedTargets.has(target.uid))
        .map((target) => {
            const distance = starDistance(source, target);
            const eta = etaTicks(distance, Math.max(fleet.speed || scan.fleetSpeed, 0.0001));
            const targetScore = frontierSupplyScore(scan, target);
            const score = (targetScore - sourceScore) * Math.max(1, fleet.st) - eta * 0.25;
            return { fleet, source, target, eta, score, distance };
        })
        .filter((assignment) => assignment.distance <= range
            && assignment.eta <= horizonTicks
            && assignment.score > 1)
        .sort((a, b) => b.score - a.score || b.fleet.st - a.fleet.st || a.eta - b.eta || a.target.uid - b.target.uid)[0];
}

function executeReturnCarriers(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    horizonTicks: number,
    commands: PlannedCommand[],
    rejected: string[],
) {
    const assignments = assignReturnCarriers(scan, stars, fleets, unavailableFleetUids, horizonTicks);
    for (const assignment of assignments) {
        unavailableFleetUids.add(assignment.fleet.uid);
        const action = assignment.dropShips > 0 ? FLEET_ORDER.DROP_ALL : FLEET_ORDER.NOTHING;
        commands.push({
            kind: "fleet_order",
            order: `add_fleet_orders,${assignment.fleet.uid},0,${assignment.target.uid},${action},0,0`,
            reason: assignment.dropShips > 0
                ? `return carrier ${assignment.fleet.uid} from ${assignment.source.n} to resupply at ${assignment.target.n}; drops ${assignment.dropShips} ships before flying back, target has ${assignment.targetAvailableShips} spare ships, eta ${assignment.eta.toFixed(1)} ticks`
                : `return empty carrier ${assignment.fleet.uid} from ${assignment.source.n} to resupply at ${assignment.target.n}; target has ${assignment.targetAvailableShips} spare ships, eta ${assignment.eta.toFixed(1)} ticks`,
        });
    }
    if (assignments.length === 0) {
        rejected.push("no idle underloaded carrier needed to return to a resupply star");
    }
}

function assignReturnCarriers(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    horizonTicks: number,
) {
    const assignments: ReturnCarrierAssignment[] = [];
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const speed = Math.max(scan.fleetSpeed, 0.0001);
    const starsByUid = new Map(stars.map((star) => [star.uid, star]));
    const sourceShips = new Map<number, number>(stars.map((star) => [star.uid, Math.max(0, star.st - EXPANSION_SOURCE_GARRISON)]));

    const idleFleets = fleets
        .filter((fleet) => fleet.o.length === 0 && Boolean(fleet.ouid) && !unavailableFleetUids.has(fleet.uid))
        .sort((a, b) => a.st - b.st || b.ouid - a.ouid || a.uid - b.uid);

    for (const fleet of idleFleets) {
        if (fleet.st >= NEUTRAL_CAPTURE_SHIPS) continue;
        const source = starsByUid.get(fleet.ouid);
        if (!source) continue;
        const localLoadNeeded = Math.max(0, NEUTRAL_CAPTURE_SHIPS - fleet.st);
        if ((sourceShips.get(source.uid) ?? 0) >= localLoadNeeded) continue;

        const target = bestReturnCarrierTarget(scan, stars, source, fleet, range, speed, horizonTicks, sourceShips);
        if (!target) continue;
        source.st += fleet.st;
        assignments.push({
            fleet,
            source,
            target: target.star,
            eta: target.eta,
            dropShips: Math.max(0, fleet.st),
            targetAvailableShips: target.availableShips,
        });
    }
    return assignments;
}

function bestReturnCarrierTarget(
    scan: ScanningData,
    stars: MutableStar[],
    source: MutableStar,
    fleet: Fleet,
    range: number,
    speed: number,
    horizonTicks: number,
    sourceShips: Map<number, number>,
) {
    const sourceScore = frontierSupplyScore(scan, source);
    const sourceAvailable = sourceShips.get(source.uid) ?? 0;
    return stars
        .filter((star) => star.uid !== source.uid)
        .map((star) => {
            const distance = starDistance(source, star);
            const eta = etaTicks(distance, speed);
            const availableShips = sourceShips.get(star.uid) ?? 0;
            const targetScore = frontierSupplyScore(scan, star);
            return { star, distance, eta, availableShips, targetScore };
        })
        .filter((candidate) => candidate.distance <= range
            && candidate.eta <= horizonTicks
            && candidate.availableShips >= NEUTRAL_CAPTURE_SHIPS
            && (candidate.targetScore < sourceScore || candidate.availableShips >= sourceAvailable + NEUTRAL_CAPTURE_SHIPS))
        .sort((a, b) => a.targetScore - b.targetScore
            || b.availableShips - a.availableShips
            || a.eta - b.eta
            || b.star.st - a.star.st
            || a.star.uid - b.star.uid)[0];
}

function frontierSupplyScore(scan: ScanningData, star: MutableStar) {
    const incoming = Object.values(scan.fleets).some((fleet) => fleet.puid !== scan.playerUid && fleet.o[0]?.[1] === star.uid)
        ? 4
        : 0;
    const shipNeed = Math.max(0, scan.tick - star.st) / Math.max(1, scan.tick);
    return star.frontierWeight + incoming + shipNeed;
}

function planDefensiveCarrierBuilds(
    scan: ScanningData,
    stars: MutableStar[],
    tacticalPlan: TacticalPlan,
    cashAvailable: number,
    reservedCash: number,
    builtCarriersThisTurn: number,
    horizonTicks: number,
    rejected: string[],
): DefensiveCarrierPlan {
    const assignments: DefensiveCarrierAssignment[] = [];
    const sourceShips = new Map(stars.map((star) => [star.uid, Math.max(0, star.st - 1)]));
    const alreadyDefendedTargets = new Set(tacticalPlan.defenseAssignments.map((assignment) => assignment.target.uid));
    let buildCost = 0;

    for (const attack of tacticalPlan.incomingAttacks.filter((entry) => entry.estimate.attackerWins)) {
        if (alreadyDefendedTargets.has(attack.target.uid)) continue;
        const cost = carrierCostFor(scan.config, builtCarriersThisTurn + assignments.length);
        if (reservedCash + buildCost + cost > cashAvailable) {
            rejected.push(`cannot build defensive carrier for ${attack.target.n}; $${cashAvailable} cash cannot cover reserved $${reservedCash + buildCost} plus carrier cost $${cost}`);
            continue;
        }
        const assignment = bestDefensiveCarrierBuild(scan, stars, sourceShips, attack, cost)
            ?? bestDefensiveCounterattackCarrierBuild(scan, stars, sourceShips, attack, cost, horizonTicks);
        if (!assignment) {
            rejected.push(`no owned star can build a defensive carrier to ${attack.target.n} before ${attack.attacker.alias} fleet ${attack.fleet.uid} arrives; ${defensiveCarrierSourceSummary(scan, stars, sourceShips, attack)}`);
            continue;
        }
        sourceShips.set(assignment.source.uid, (sourceShips.get(assignment.source.uid) ?? 0) - assignment.ships);
        assignments.push(assignment);
        buildCost += cost;
        alreadyDefendedTargets.add(attack.target.uid);
    }

    return { assignments, buildCount: assignments.length, buildCost };
}

function defensiveCarrierSourceSummary(
    scan: ScanningData,
    stars: MutableStar[],
    sourceShips: Map<number, number>,
    attack: IncomingAttack,
) {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const candidates = stars
        .filter((source) => source.uid !== attack.target.uid)
        .map((source) => {
            const distance = starDistance(source, attack.target);
            const eta = etaTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
            const availableShips = Math.max(0, sourceShips.get(source.uid) ?? 0);
            const ships = requiredDefensiveCarrierShips(scan, attack, availableShips);
            return `${source.n}: eta ${eta.toFixed(1)}, dist ${distance.toFixed(2)}/${range.toFixed(2)}, ships ${availableShips}, required ${ships ?? "unavailable"}`;
        })
        .slice(0, 5);
    return candidates.length > 0 ? candidates.join("; ") : "no owned source stars";
}

function bestDefensiveCarrierBuild(
    scan: ScanningData,
    stars: MutableStar[],
    sourceShips: Map<number, number>,
    attack: IncomingAttack,
    cost: number,
): DefensiveCarrierAssignment | undefined {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    return stars
        .filter((source) => source.uid !== attack.target.uid)
        .map((source) => {
            const distance = starDistance(source, attack.target);
            const eta = etaTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
            const availableShips = Math.max(0, sourceShips.get(source.uid) ?? 0);
            const ships = requiredDefensiveCarrierShips(scan, attack, availableShips);
            return { source, distance, eta, availableShips, ships };
        })
        .filter((candidate) => candidate.distance <= range
            && candidate.eta < attack.eta
            && candidate.ships !== undefined
            && candidate.ships <= candidate.availableShips)
        .sort((a, b) => (a.ships ?? Number.POSITIVE_INFINITY) - (b.ships ?? Number.POSITIVE_INFINITY)
            || a.eta - b.eta
            || b.availableShips - a.availableShips
            || a.source.uid - b.source.uid)
        .map((candidate) => ({
            mode: "defend" as const,
            source: candidate.source,
            target: attack.target,
            attack,
            ships: candidate.ships ?? 0,
            eta: candidate.eta,
            cost,
        }))[0];
}

function bestDefensiveCounterattackCarrierBuild(
    scan: ScanningData,
    stars: MutableStar[],
    sourceShips: Map<number, number>,
    attack: IncomingAttack,
    cost: number,
    horizonTicks: number,
): DefensiveCarrierAssignment | undefined {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    return stars
        .filter((source) => source.uid !== attack.target.uid)
        .map((source) => {
            const distance = starDistance(source, attack.target);
            const eta = etaTicks(distance, Math.max(scan.fleetSpeed, 0.0001));
            const availableShips = Math.max(0, sourceShips.get(source.uid) ?? 0);
            const ships = requiredCounterattackCarrierShips(scan, attack, availableShips);
            return { source, distance, eta, availableShips, ships };
        })
        .filter((candidate) => candidate.distance <= range
            && candidate.eta >= attack.eta
            && candidate.eta <= horizonTicks
            && candidate.ships !== undefined
            && candidate.ships <= candidate.availableShips)
        .sort((a, b) => a.eta - b.eta
            || (a.ships ?? Number.POSITIVE_INFINITY) - (b.ships ?? Number.POSITIVE_INFINITY)
            || b.availableShips - a.availableShips
            || a.source.uid - b.source.uid)
        .map((candidate) => ({
            mode: "counterattack" as const,
            source: candidate.source,
            target: attack.target,
            attack,
            ships: candidate.ships ?? 0,
            eta: candidate.eta,
            cost,
        }))[0];
}

function requiredDefensiveCarrierShips(scan: ScanningData, attack: IncomingAttack, availableShips: number) {
    const baseDefenders = orbitingShipsAt(scan, attack.target.uid, attack.target.puid, attack.eta);
    for (let ships = Math.max(1, attack.estimate.additionalDefendersNeeded); ships <= availableShips; ships += 1) {
        const estimate = estimateStarBattle(
            scan,
            attack.fleet.puid,
            attack.estimate.attackerShips,
            attack.target,
            attack.eta,
            baseDefenders + ships,
        );
        if (!estimate.attackerWins) {
            return ships;
        }
    }
    return undefined;
}

function requiredCounterattackCarrierShips(scan: ScanningData, attack: IncomingAttack, availableShips: number) {
    const player = scan.players[String(scan.playerUid)];
    const attacker = scan.players[String(attack.attacker.uid)];
    if (!player || !attacker) return undefined;
    const occupyingShips = Math.max(1, attack.estimate.attackerRemaining);
    for (let ships = 1; ships <= availableShips; ships += 1) {
        const estimate = estimateBattle({
            attackerUid: scan.playerUid,
            defenderUid: attack.attacker.uid,
            attackerShips: ships,
            defenderShips: occupyingShips,
            attackerWeapons: weaponsValue(player),
            defenderWeapons: weaponsValue(attacker),
        });
        if (estimate.attackerWins) {
            return ships;
        }
    }
    return undefined;
}

function executeDefensiveCarrierBuilds(
    plan: DefensiveCarrierPlan,
    cashStart: number,
    commands: PlannedCommand[],
    rejected: string[],
) {
    let cash = cashStart;
    let builtCount = 0;
    for (const assignment of plan.assignments) {
        if (cash < assignment.cost) {
            rejected.push(`not enough cash to build defensive carrier from ${assignment.source.n} to ${assignment.target.n}: $${cash} < $${assignment.cost}`);
            continue;
        }
        cash -= assignment.cost;
        builtCount += 1;
        assignment.source.st -= assignment.ships;
        const action = assignment.mode === "defend"
            ? `defensive carrier at ${assignment.source.n} with ${assignment.ships} ships for ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} before ${assignment.attack.attacker.alias} fleet ${assignment.attack.fleet.uid} eta ${assignment.attack.eta.toFixed(1)}`
            : `counterattack carrier at ${assignment.source.n} with ${assignment.ships} ships for ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} after ${assignment.attack.attacker.alias} fleet ${assignment.attack.fleet.uid} eta ${assignment.attack.eta.toFixed(1)}`;
        commands.push({
            kind: "new_fleet",
            order: `new_fleet,${assignment.source.uid},${assignment.ships}`,
            reason: `build ${action}`,
            followUpTargetUid: assignment.target.uid,
            followUpReason: `route ${assignment.mode} carrier to ${assignment.target.n}`,
        });
    }
    return { cash, builtCount };
}

function executeShipStaging(
    scan: ScanningData,
    stars: MutableStar[],
    cashStart: number,
    builtCarriersThisTurn: number,
    remainingBudget: number,
    commands: PlannedCommand[],
    rejected: string[],
): CarrierExecution {
    let cash = cashStart;
    if (cash < 200) {
        rejected.push(`skipped low-priority staging carrier build because cash $${cash} is below the $200 staging reserve`);
        return { cash, builtCount: 0 };
    }

    const assignment = stagingAssignment(scan, stars);
    if (!assignment) {
        rejected.push(`no owned star with more ships than tick ${scan.tick} can stage closer toward an enemy empire`);
        return { cash, builtCount: 0 };
    }

    const cost = carrierCostFor(scan.config, builtCarriersThisTurn);
    if (cost > remainingBudget) {
        rejected.push(`skipped low-priority staging carrier build because remaining carrier-build budget $${remainingBudget} is below carrier cost $${cost}`);
        return { cash, builtCount: 0 };
    }
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

function assignCarrierCoverage(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    unavailableFleetUids: Set<number>,
    budget: number,
    horizonTicks: number,
    builtCarriersThisTurn: number,
    rejected: string[],
) {
    const expansionHorizonTicks = Math.max(1, horizonTicks);
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const speed = Math.max(scan.fleetSpeed, 0.0001);
    const assignedTargets = new Set<number>();
    const fleetAssignments: CarrierFleetAssignment[] = [];
    const newCarrierAssignments: NewCarrierAssignment[] = [];
    const sourceShips = new Map<number, number>(stars.map((star) => [star.uid, Math.max(0, star.st - EXPANSION_SOURCE_GARRISON)]));
    const starsByUid = new Map(stars.map((star) => [star.uid, star]));
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
        const source = starsByUid.get(fleet.ouid);
        if (!source) continue;
        const loadShips = Math.max(0, NEUTRAL_CAPTURE_SHIPS - fleet.st);
        if ((sourceShips.get(source.uid) ?? 0) < loadShips) continue;
        const target = nearestReachableNeutralForFleet(scan, fleet, neutralTargets, assignedTargets, range, expansionHorizonTicks);
        if (!target) continue;
        assignedTargets.add(target.star.uid);
        sourceShips.set(source.uid, (sourceShips.get(source.uid) ?? 0) - loadShips);
        fleetAssignments.push({
            fleet,
            source,
            target: target.star,
            eta: target.eta,
            loadShips,
            departureShips: fleet.st + loadShips,
        });
    }

    let plannedSpend = 0;
    for (const target of neutralTargets) {
        if (assignedTargets.has(target.star.uid)) continue;
        const nextCost = carrierCostFor(scan.config, builtCarriersThisTurn + newCarrierAssignments.length);
        if (plannedSpend + nextCost > budget) {
            rejected.push(`neutral ${target.star.n} is reachable but skipped by carrier budget $${budget}; next carrier costs $${nextCost}`);
            continue;
        }
        const source = bestCarrierSource(stars, sourceShips, target.star, range, speed, expansionHorizonTicks);
        if (!source) continue;
        assignedTargets.add(target.star.uid);
        sourceShips.set(source.source.uid, (sourceShips.get(source.source.uid) ?? 0) - NEUTRAL_CAPTURE_SHIPS);
        plannedSpend += nextCost;
        newCarrierAssignments.push({
            source: source.source,
            target: target.star,
            distance: source.distance,
            eta: source.eta,
            ships: NEUTRAL_CAPTURE_SHIPS,
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
            const routeAttack = incomingAttackFromRoute(scan, fleet, starsByUid);
            const target = routeAttack?.target;
            const attacker = scan.players[String(fleet.puid)];
            if (!routeAttack || !target || !attacker) return undefined;
            const estimate = estimateStarBattle(
                scan,
                fleet.puid,
                routeAttack.ships,
                target,
                routeAttack.eta,
                orbitingShipsAt(scan, target.uid, target.puid, routeAttack.eta),
            );
            return { fleet, attacker, target, eta: routeAttack.eta, estimate };
        })
        .filter((attack): attack is IncomingAttack => Boolean(attack))
        .sort((a, b) => a.eta - b.eta || b.estimate.attackerShips - a.estimate.attackerShips || a.fleet.uid - b.fleet.uid);
}

function incomingAttackFromRoute(scan: ScanningData, fleet: Fleet, ownedTargets: Map<number, MutableStar>) {
    let ships = Math.max(0, fleet.st);
    let eta = 0;
    let position: Pick<Star, "x" | "y"> = fleet;
    const speed = Math.max(fleet.speed || scan.fleetSpeed, 0.0001);

    for (const [delayRaw, targetUid, action, argument] of fleet.o) {
        const target = scan.stars[String(targetUid)];
        if (!target) return undefined;
        const delay = safeNumber(delayRaw, 0);
        eta += delay + etaTicks(starDistance(position, target), speed);

        const ownedTarget = ownedTargets.get(target.uid);
        if (ownedTarget) {
            return {
                target: ownedTarget,
                eta,
                ships,
            };
        }

        if (isScanned(target) && target.puid === fleet.puid && ships > 0) {
            ships = applyFleetOrderAction(ships, projectedStarShips(scan, target, eta), action, argument);
        }
        position = target;
    }
    return undefined;
}

function applyFleetOrderAction(fleetShips: number, starShips: number, action: number, argument: number) {
    let transferred = 0;
    switch (action) {
        case FLEET_ORDER.NOTHING:
            break;
        case FLEET_ORDER.COLLECT_ALL:
            transferred = -starShips;
            break;
        case FLEET_ORDER.COLLECT:
            transferred = -argument;
            break;
        case FLEET_ORDER.COLLECT_ALL_BUT:
            transferred = Math.min(0, -starShips + argument);
            break;
        case FLEET_ORDER.DROP_ALL:
            transferred = fleetShips;
            break;
        case FLEET_ORDER.DROP:
            transferred = argument;
            break;
        case FLEET_ORDER.DROP_ALL_BUT:
            transferred = Math.max(0, fleetShips - argument);
            break;
        case FLEET_ORDER.GARRISON:
            transferred = -starShips + argument;
            break;
    }
    transferred = Math.max(-starShips, transferred);
    transferred = Math.min(fleetShips, transferred);
    return Math.max(0, fleetShips - transferred);
}

function assignDirectDefenses(
    scan: ScanningData,
    ownFleets: Fleet[],
    incomingAttacks: IncomingAttack[],
    assignedFleetUids: Set<number>,
) {
    const assignments: FleetRouteAssignment[] = [];
    for (const attack of incomingAttacks.filter((entry) => entry.estimate.attackerWins)) {
        const defenseGroup = bestDefensiveFleetGroup(scan, ownFleets, assignedFleetUids, attack);
        if (defenseGroup.length === 0) continue;
        for (const fleet of defenseGroup) {
            assignedFleetUids.add(fleet.uid);
            const eta = etaFromFleet(scan, fleet, attack.target);
            assignments.push({
                fleet,
                target: attack.target,
                eta,
                role: "defend",
                reason: `reinforce ${attack.target.n} against ${attack.attacker.alias} fleet ${attack.fleet.uid}; ${fleet.st} ships arrive in ${eta.toFixed(1)} ticks before enemy eta ${attack.eta.toFixed(1)}`,
            });
        }
    }
    return assignments;
}

function bestDefensiveFleetGroup(
    scan: ScanningData,
    ownFleets: Fleet[],
    assignedFleetUids: Set<number>,
    attack: IncomingAttack,
) {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const candidates = idleOrbitingFleets(ownFleets, assignedFleetUids)
        .map((fleet) => ({
            fleet,
            eta: etaFromFleet(scan, fleet, attack.target),
            distance: distanceFromFleetOrigin(scan, fleet, attack.target),
        }))
        .filter((candidate) => candidate.distance <= range && candidate.eta < attack.eta)
        .sort((a, b) => b.fleet.st - a.fleet.st || a.eta - b.eta || a.fleet.uid - b.fleet.uid)
        .slice(0, 12);
    const baseDefenders = orbitingShipsAt(scan, attack.target.uid, attack.target.puid, attack.eta);
    const margin = defensiveBattleMargin(scan, attack.attacker.uid);
    let best: { fleets: Fleet[]; totalShips: number; latestEta: number; remaining: number } | undefined;

    const search = (index: number, selected: Fleet[], totalShips: number, latestEta: number) => {
        if (best && totalShips >= best.totalShips) return;
        const estimate = estimateStarBattle(
            scan,
            attack.fleet.puid,
            attack.fleet.st,
            attack.target,
            attack.eta,
            baseDefenders + totalShips,
        );
        if (!estimate.attackerWins && estimate.defenderRemaining >= margin) {
            best = { fleets: [...selected], totalShips, latestEta, remaining: estimate.defenderRemaining };
            return;
        }
        if (index >= candidates.length) return;
        for (let i = index; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            if (!candidate) continue;
            search(
                i + 1,
                [...selected, candidate.fleet],
                totalShips + candidate.fleet.st,
                Math.max(latestEta, candidate.eta),
            );
        }
    };

    search(0, [], 0, 0);
    return best?.fleets
        .sort((a, b) => etaFromFleet(scan, a, attack.target) - etaFromFleet(scan, b, attack.target) || b.st - a.st || a.uid - b.uid)
        ?? [];
}

function chooseRallyPlan(
    scan: ScanningData,
    stars: MutableStar[],
    ownFleets: Fleet[],
    assignedFleetUids: Set<number>,
    horizonTicks: number,
): RallyPlan | undefined {
    const threats = potentialThreats(scan, stars, horizonTicks);
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
            const reachableShips = rallyReachableShips(scan, ownFleets, rallyStar, assignedFleetUids, horizonTicks);
            return { rallyStar, coveredTargets, requiredShips, availableShips, reachableShips };
        })
        .filter((plan) => plan.coveredTargets.length > 0
            && plan.requiredShips > plan.availableShips
            && plan.requiredShips <= plan.availableShips + plan.reachableShips)
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
    horizonTicks: number,
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
        .filter((candidate) => candidate.distance <= range && candidate.eta <= horizonTicks)
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
        .sort((a, b) => territoryValue(b) - territoryValue(a) || b.st - a.st || a.uid - b.uid);
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const margin = offensiveBattleMargin(scan);

    for (const fleet of idleOrbitingFleets(ownFleets, assignedFleetUids)) {
        const attack = enemyTargets
            .filter((target) => !attackedTargetUids.has(target.uid))
            .map((target) => {
                const distance = distanceFromFleetOrigin(scan, fleet, target);
                const eta = etaFromFleet(scan, fleet, target);
                const estimate = estimateStarBattle(scan, scan.playerUid, fleet.st, target, eta, orbitingShipsAt(scan, target.uid, target.puid, eta));
                return { target, distance, eta, estimate };
            })
            .filter((candidate) => candidate.distance <= range && candidate.estimate.attackerWins && candidate.estimate.attackerRemaining >= margin)
            .sort((a, b) => territoryValue(b.target) - territoryValue(a.target)
                || b.estimate.attackerRemaining - a.estimate.attackerRemaining
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
            reason: `attack ${attack.target.n} (NR ${territoryValue(attack.target)}); carrier ${fleet.uid} wins with ${attack.estimate.attackerRemaining} ships remaining by battle estimate against margin ${margin}`,
        });
    }
    return assignments;
}

function offensiveBattleMargin(scan: ScanningData) {
    const player = scan.players[String(scan.playerUid)];
    return Math.max(1, Math.ceil(weaponsValue(player)));
}

function potentialThreats(scan: ScanningData, stars: MutableStar[], horizonTicks: number): PotentialThreat[] {
    const horizon = Math.max(1, horizonTicks);
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
    return `${attack.attacker.alias} fleet ${attack.fleet.uid} is attacking ${attack.target.n} with ${attack.estimate.attackerShips} ships; eta ${attack.eta.toFixed(1)} ticks, ${outcome}`;
}

function defensiveBattleMargin(scan: ScanningData, attackerUid: number) {
    const attacker = scan.players[String(attackerUid)];
    return Math.max(1, Math.ceil(weaponsValue(attacker)));
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

function rallyReachableShips(
    scan: ScanningData,
    ownFleets: Fleet[],
    rallyStar: MutableStar,
    assignedFleetUids: Set<number>,
    horizonTicks: number,
) {
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    return idleOrbitingFleets(ownFleets, assignedFleetUids)
        .filter((fleet) => fleet.ouid !== rallyStar.uid)
        .map((fleet) => ({
            fleet,
            eta: etaFromFleet(scan, fleet, rallyStar),
            distance: distanceFromFleetOrigin(scan, fleet, rallyStar),
        }))
        .filter((candidate) => candidate.distance <= range && candidate.eta <= horizonTicks)
        .reduce((total, candidate) => total + candidate.fleet.st, 0);
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

function draftDiplomacy(scan: ScanningData, messages: unknown[], suppressedRecipients = new Set<number>()): DiplomacyDraft[] {
    const player = scan.players[String(scan.playerUid)];
    if (!player) return [];

    const attackDrafts = draftAttackObjections(scan, messages)
        .filter((draft) => !suppressedRecipients.has(draft.recipientUid));
    const objectedTo = new Set(attackDrafts.map((draft) => draft.recipientUid));
    const techDrafts = neighboringEmpires(scan).flatMap((neighbor) => {
        if (suppressedRecipients.has(neighbor.uid)) return [];
        if (objectedTo.has(neighbor.uid)) return [];
        const history = diplomacyHistoryWith(scan.playerUid, neighbor.uid, messages);
        const friendly = hasFastReply(scan.playerUid, neighbor.uid, history);
        const latestInbound = latestMessageFrom(neighbor.uid, history);
        const latestOutbound = latestMessageFrom(scan.playerUid, history);
        const unansweredInbound = latestInbound !== undefined
            && (latestOutbound === undefined || latestInbound.created > latestOutbound.created);
        const responding = unansweredInbound && (friendly || latestOutbound === undefined);
        if (history.length > 0 && !responding) {
            return [];
        }
        const research = techName(player.researching);
        const latestInboundBody = responding ? latestInbound.body : undefined;
        const reply = responding
            ? techDiplomacyReply(scan.playerUid, player.alias, neighbor.alias, player.researching, history, latestInboundBody)
            : undefined;
        if (responding && !reply) {
            return [];
        }

        const draft: DiplomacyDraft = {
            recipientUid: neighbor.uid,
            recipientAlias: neighbor.alias,
            recipientColor: neighbor.color,
            fromColor: playerColorStyle(player.color),
            friendly,
            subject: responding ? "Re: tech cooperation" : "Tech trading",
            body: reply?.body ?? diplomacyBody(player.alias, neighbor.alias, research),
            reason: responding
                ? reply?.reason ?? `${neighbor.alias} replied within 8h; draft keeps the tech-trade conversation moving`
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

function techDiplomacyReply(
    myUid: number,
    myAlias: string,
    theirAlias: string,
    researchKind: number,
    history: DiplomacyEvent[],
    latestInboundBody?: string,
) {
    if (!latestInboundBody) return undefined;

    const previousOutbound = latestMessageFrom(myUid, history);
    const inboundTechs = explicitTechKinds(latestInboundBody);
    const tradePartnerTech = inboundTechs.find((kind) => kind !== researchKind);
    const priorOutboundBody = previousOutbound?.body ?? "";
    const outboundTechs = explicitTechKinds(priorOutboundBody);
    const alreadyConfirmed = tradePartnerTech !== undefined
        && outboundTechs.includes(researchKind)
        && outboundTechs.includes(tradePartnerTech)
        && /trade|exchange|send|reciprocate|line up|works/i.test(priorOutboundBody);

    if (alreadyConfirmed && isRoutineTradeContinuation(latestInboundBody)) {
        return undefined;
    }

    if (tradePartnerTech !== undefined) {
        return {
            body: [
                `Hi ${npLink(theirAlias)}, that works for me.`,
                `Let's line up ${techName(researchKind)} from me for ${techName(tradePartnerTech)} from you when each completes.`,
                "If either research path changes, let me know before sending so we keep the exchange even.",
                `- ${npLink(myAlias)}`,
            ].join("\n\n"),
            reason: `${theirAlias} named ${techName(tradePartnerTech)}; draft confirms a concrete ${techName(researchKind)} for ${techName(tradePartnerTech)} trade`,
        };
    }

    if (isRoutineTradeContinuation(latestInboundBody)) {
        return undefined;
    }

    return undefined;
}

function diplomacyBody(myAlias: string, theirAlias: string, research: string) {
    const opener = `Hi ${npLink(theirAlias)}, it looks like we are going to be neighbors.`;
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

function techKindValue(value: unknown) {
    const numericValue = numeric(value);
    if (numericValue !== undefined) return numericValue;
    if (typeof value !== "string") return undefined;
    const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
    for (const [kind, aliases] of techAliases()) {
        if (aliases.some((alias) => normalized === alias.replace(/[^a-z]/g, ""))) {
            return kind;
        }
    }
    return undefined;
}

function explicitTechKinds(text: string) {
    const normalized = text.toLowerCase();
    const kinds: number[] = [];
    const patterns: Array<[number, RegExp]> = [
        [TECH.BANKING, /\bbanking\b/],
        [TECH.RESEARCH, /\bexperimentation\b/],
        [TECH.MANUFACTURING, /\bmanufacturing\b/],
        [TECH.PROPULSION, /\bpropulsion\b/],
        [TECH.SCANNING, /\bscanning\b/],
        [TECH.WEAPONS, /\bweapons?\b/],
        [TECH.TERRAFORMING, /\bterraforming\b/],
    ];
    for (const [kind, pattern] of patterns) {
        if (pattern.test(normalized)) kinds.push(kind);
    }
    return kinds;
}

function isRoutineTradeContinuation(text: string) {
    return /trade|exchange|coordinate|cooperate|shared progress|mutual interests|which .*tech|what .*research|path of discovery|technological/i.test(text);
}

function techAliases(): Array<[number, string[]]> {
    return [
        [TECH.BANKING, ["banking", "bank", "banks", "economy"]],
        [TECH.RESEARCH, ["experimentation", "experiment", "research", "exp", "science"]],
        [TECH.MANUFACTURING, ["manufacturing", "manufacture", "manu", "industry"]],
        [TECH.PROPULSION, ["propulsion", "range", "hyperspace"]],
        [TECH.SCANNING, ["scanning", "scan", "sensors"]],
        [TECH.WEAPONS, ["weapons", "weapon", "weap", "combat"]],
        [TECH.TERRAFORMING, ["terraforming", "terra", "resources"]],
    ];
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
        .sort((a, b) => territoryValue(b.star) - territoryValue(a.star)
            || a.nearestOwnedDistance - b.nearestOwnedDistance
            || a.star.uid - b.star.uid);
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
        .sort((a, b) => territoryValue(b.star) - territoryValue(a.star)
            || a.eta - b.eta
            || a.distance - b.distance
            || a.star.uid - b.star.uid)[0];
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
        .filter((star) => (sourceShips.get(star.uid) ?? 0) >= NEUTRAL_CAPTURE_SHIPS)
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

function etaTicks(distance: number, speed: number) {
    return distance / Math.max(speed, 0.0001);
}

function carrierCostFor(config: GameConfig, buildIndex: number) {
    return config.fleetCost + config.fleetInc * buildIndex;
}

function frontierWeight(scan: ScanningData, star: ScannedStar) {
    let nearestEnemy = Number.POSITIVE_INFINITY;
    let nearestNeutral = Number.POSITIVE_INFINITY;
    for (const other of Object.values(scan.stars)) {
        if (other.uid === star.uid || other.puid === scan.playerUid) continue;
        const distance = starDistance(star, other);
        if (other.puid > 0 && activePlayer(scan, other.puid)) {
            nearestEnemy = Math.min(nearestEnemy, distance);
        } else if (other.puid <= 0) {
            nearestNeutral = Math.min(nearestNeutral, distance);
        }
    }
    const player = scan.players[String(scan.playerUid)];
    const range = Math.max(0.1, rangeValue(player));
    const enemyPressure = Number.isFinite(nearestEnemy)
        ? Math.max(0, 1 - nearestEnemy / (range * 2.5))
        : 0;
    const neutralPressure = Number.isFinite(nearestNeutral)
        ? Math.max(0, 1 - nearestNeutral / (range * 1.5))
        : 0;
    const incomingPressure = Object.values(scan.fleets).some((fleet) => {
        const targetUid = fleet.o[0]?.[1];
        return fleet.puid !== scan.playerUid && targetUid === star.uid;
    }) ? 1 : 0;
    return 1 + enemyPressure * 2.5 + neutralPressure * 1.25 + incomingPressure * 3;
}

function isScanned(star: Star): star is ScannedStar {
    return (star as { v: unknown }).v === 1 || (star as { v: unknown }).v === "1";
}

function territoryValue(star: Star) {
    return safeNumber((star as { nr?: unknown }).nr, 0);
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

function weaponsValue(player: Player | undefined) {
    if (!player) return 1;
    return techLevel(player, TECH.WEAPONS);
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
