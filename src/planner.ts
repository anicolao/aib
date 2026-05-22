import type { Fleet, GameConfig, Player, ScannedStar, ScanningData, Star, TechInfo } from "./types.js";
import type { PlannedCommand } from "./command.js";

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
    defensive: boolean;
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
    const carrierPlan = config.buildCarrier
        ? planCarrierCoverage(scan, stars, ownFleets)
        : { buildCount: 0, buildCost: 0 };

    let cash = safeNumber(player.cash, 0);
    const reserve = Math.max(
        Math.floor(cash * config.cashReserveRatio),
        carrierPlan.buildCost,
    );
    cash = buyInfrastructure(scan, player, stars, cash, reserve, config, commands, rejected);

    if (config.buildCarrier) {
        cash = executeCarrierCoverage(scan, stars, ownFleets, cash, commands, rejected);
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
            rejected.push(`no infrastructure candidate passed affordability, production-timing, and ratio-cap filters within spendable budget $${spendable}`);
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

function planCarrierCoverage(scan: ScanningData, stars: MutableStar[], fleets: Fleet[]): CarrierPlan {
    const { newCarrierAssignments } = assignCarrierCoverage(scan, stars, fleets);
    return {
        buildCount: newCarrierAssignments.length,
        buildCost: newCarrierAssignments.reduce((total, _assignment, index) => total + carrierCostFor(scan.config, index), 0),
    };
}

function executeCarrierCoverage(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    cashStart: number,
    commands: PlannedCommand[],
    rejected: string[],
) {
    let cash = cashStart;
    const { fleetAssignments, newCarrierAssignments, uncoveredNeutralTargets } = assignCarrierCoverage(scan, stars, fleets);

    for (const assignment of fleetAssignments) {
        commands.push({
            kind: "fleet_order",
            order: `add_fleet_orders,${assignment.fleet.uid},0,${assignment.target.uid},0,0,0`,
            reason: `idle carrier ${assignment.fleet.uid} routed to neutral ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} ticks before production`,
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
            reason: assignment.defensive
                ? `build defensive carrier at ${assignment.source.n} for visible threat to ${assignment.target.n}`
                : `build carrier at ${assignment.source.n} for neutral ${assignment.target.n}; eta ${assignment.eta.toFixed(1)} ticks before production`,
        };
        if (!assignment.defensive) {
            command.followUpTargetUid = assignment.target.uid;
            command.followUpReason = `route new carrier to neutral ${assignment.target.n}`;
        }
        commands.push(command);
    }

    for (const target of uncoveredNeutralTargets) {
        rejected.push(`neutral ${target.star.n} is reachable before production but has no available carrier source`);
    }

    if (fleetAssignments.length === 0 && newCarrierAssignments.length === 0 && uncoveredNeutralTargets.length === 0) {
        rejected.push("no neutral stars are reachable before next production and no defensive carrier need was found");
    }

    return cash;
}

function assignCarrierCoverage(scan: ScanningData, stars: MutableStar[], fleets: Fleet[]) {
    const ticksUntilProduction = nextProductionTicks(scan);
    const range = rangeValue(scan.players[String(scan.playerUid)]);
    const speed = Math.max(scan.fleetSpeed, 0.0001);
    const assignedTargets = new Set<number>();
    const fleetAssignments: { fleet: Fleet; target: Star; eta: number }[] = [];
    const newCarrierAssignments: NewCarrierAssignment[] = [];
    const sourceShips = new Map<number, number>(stars.map((star) => [star.uid, Math.max(0, star.st - 1)]));
    const idleFleets = fleets
        .filter((fleet) => fleet.o.length === 0 && fleet.st > 0 && Boolean(fleet.ouid))
        .sort((a, b) => b.st - a.st || a.uid - b.uid);
    const neutralTargets = reachableNeutralTargets(scan, stars, range, speed, ticksUntilProduction);

    for (const fleet of idleFleets) {
        const target = nearestReachableNeutralForFleet(scan, fleet, neutralTargets, assignedTargets, range, ticksUntilProduction);
        if (!target) continue;
        assignedTargets.add(target.star.uid);
        fleetAssignments.push({ fleet, target: target.star, eta: target.eta });
    }

    for (const target of neutralTargets) {
        if (assignedTargets.has(target.star.uid)) continue;
        const source = bestCarrierSource(stars, sourceShips, target.star, range, speed, ticksUntilProduction);
        if (!source) continue;
        assignedTargets.add(target.star.uid);
        sourceShips.set(source.source.uid, (sourceShips.get(source.source.uid) ?? 0) - 1);
        newCarrierAssignments.push({
            source: source.source,
            target: target.star,
            distance: source.distance,
            eta: source.eta,
            defensive: false,
        });
    }

    const assignedFleetUids = new Set(fleetAssignments.map((assignment) => assignment.fleet.uid));
    for (const target of defensiveCarrierTargets(scan, stars, fleets, assignedFleetUids, ticksUntilProduction)) {
        const sourceShipsAvailable = sourceShips.get(target.uid) ?? 0;
        if (sourceShipsAvailable <= 0) {
            continue;
        }
        sourceShips.set(target.uid, sourceShipsAvailable - 1);
        newCarrierAssignments.push({
            source: target,
            target,
            distance: 0,
            eta: 0,
            defensive: true,
        });
    }

    return {
        fleetAssignments,
        newCarrierAssignments,
        uncoveredNeutralTargets: neutralTargets.filter((target) => !assignedTargets.has(target.star.uid)),
    };
}

function ownedScannedStars(scan: ScanningData) {
    return Object.values(scan.stars)
        .filter((star): star is ScannedStar => isScanned(star) && star.puid === scan.playerUid);
}

function draftDiplomacy(scan: ScanningData, messages: unknown[]): DiplomacyDraft[] {
    const player = scan.players[String(scan.playerUid)];
    if (!player) return [];

    return neighboringEmpires(scan).flatMap((neighbor) => {
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

        const draft: DiplomacyDraft = {
            recipientUid: neighbor.uid,
            recipientAlias: neighbor.alias,
            recipientColor: neighbor.color,
            fromColor: playerColorStyle(player.color),
            friendly,
            subject: responding ? "Re: tech cooperation" : "Tech trading",
            body: diplomacyBody(player.alias, neighbor.alias, research, responding),
            reason: responding
                ? `${neighbor.alias} replied within 8h; draft keeps the tech-trade conversation moving`
                : `${neighbor.alias} is a neighboring empire at ${neighbor.distance.toFixed(2)} ly; draft opens with research disclosure and tech-trade cooperation`,
        };
        if (responding && latestInbound.threadKey) {
            draft.threadKey = latestInbound.threadKey;
        }
        return [draft];
    });
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

function diplomacyHistoryWith(myUid: number, theirUid: number, messages: unknown[]) {
    return messages
        .flatMap((message) => messageEvents(message))
        .filter((event) => event.fromUid === myUid || event.fromUid === theirUid)
        .filter((event) => event.toUids.includes(myUid) || event.toUids.includes(theirUid))
        .filter((event) => event.toUids.length === 0 || event.toUids.includes(myUid) || event.toUids.includes(theirUid))
        .sort((a, b) => a.created - b.created);
}

function messageEvents(message: unknown) {
    const root = message as DiplomacyMessage;
    const threadKey = messageKey(message);
    const events = [messageEvent(root)]
        .filter((event): event is ReturnType<typeof messageEvent> & { created: number; fromUid: number; toUids: number[] } => Boolean(event));
    for (const comment of root.comments ?? []) {
        const event = commentEvent(comment, root);
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
    return { created, fromUid, toUids };
}

function commentEvent(comment: DiplomacyComment, parent: DiplomacyMessage) {
    const created = timestampMs(comment.payload?.created ?? comment.created);
    const fromUid = numeric(comment.payload?.senderUid ?? comment.payload?.from_uid ?? comment.player_uid);
    const toUids = numericArray(parent.payload?.to_uids);
    if (created === undefined || fromUid === undefined) return undefined;
    return { created, fromUid, toUids };
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

function diplomacyBody(myAlias: string, theirAlias: string, research: string, responding: boolean) {
    const opener = responding
        ? `Hi ${theirAlias}, thanks for the quick reply.`
        : `Hi ${theirAlias}, it looks like we are going to be neighbors.`;
    return [
        opener,
        `I am currently researching ${research}.`,
        "I would like to coordinate tech trades where it is mutually profitable, especially when we can avoid duplicating research and both accelerate our starts.",
        "Let me know what you are researching and what trades you would be open to lining up.",
        `- ${myAlias}`,
    ].join("\n\n");
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
    ticksUntilProduction: number,
): NeutralTarget[] {
    return Object.values(scan.stars)
        .filter(isNeutralStar)
        .map((star) => ({
            star,
            nearestOwnedDistance: nearestOwnedDistance(stars, star),
        }))
        .filter((target) => target.nearestOwnedDistance <= range && etaTicks(target.nearestOwnedDistance, speed) <= ticksUntilProduction)
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
    ticksUntilProduction: number,
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
        .filter((target) => target.distance <= range && target.eta <= ticksUntilProduction)
        .sort((a, b) => a.eta - b.eta || a.distance - b.distance || a.star.uid - b.star.uid)[0];
}

function bestCarrierSource(
    stars: MutableStar[],
    sourceShips: Map<number, number>,
    target: Star,
    range: number,
    speed: number,
    ticksUntilProduction: number,
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
        .filter((candidate) => candidate.distance <= range && candidate.eta <= ticksUntilProduction)
        .sort((a, b) => a.eta - b.eta || a.distance - b.distance || b.source.st - a.source.st)[0];
}

function defensiveCarrierTargets(
    scan: ScanningData,
    stars: MutableStar[],
    fleets: Fleet[],
    assignedFleetUids: Set<number>,
    ticksUntilProduction: number,
) {
    const ownedFleetAtStar = new Set(
        fleets
            .filter((fleet) => fleet.puid === scan.playerUid && fleet.ouid && !assignedFleetUids.has(fleet.uid))
            .map((fleet) => fleet.ouid),
    );
    const threatened = new Set<number>();
    for (const fleet of Object.values(scan.fleets)) {
        if (fleet.puid === scan.playerUid) continue;
        const firstOrder = fleet.o[0];
        if (!firstOrder) continue;
        const [delay, targetUid] = firstOrder;
        const target = scan.stars[String(targetUid)];
        if (!target || target.puid !== scan.playerUid) continue;
        const speed = Math.max(fleet.speed || scan.fleetSpeed, 0.0001);
        const eta = safeNumber(delay, 0) + etaTicks(starDistance(fleet, target), speed);
        if (eta <= ticksUntilProduction) {
            threatened.add(target.uid);
        }
    }
    return stars
        .filter((star) => threatened.has(star.uid) && !ownedFleetAtStar.has(star.uid))
        .sort((a, b) => b.frontierWeight - a.frontierWeight || b.st - a.st);
}

function nearestOwnedDistance(stars: MutableStar[], target: Star) {
    return stars.reduce((nearest, star) => Math.min(nearest, starDistance(star, target)), Number.POSITIVE_INFINITY);
}

function nextProductionTicks(scan: ScanningData) {
    const remaining = scan.productionRate - scan.productionCounter;
    return remaining > 0 ? remaining : Math.max(1, scan.productionRate);
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
