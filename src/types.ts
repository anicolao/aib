/**
 * Neptune's Pride 4 (NP4) API Types
 * 
 * This file contains definitive, fully documented TypeScript types for the NP4 API response.
 * It uses type narrowing to represent different states of game objects and avoids optional parameters.
 */

/**
 * The top-level response object from the Neptune's Pride 4 API.
 */
export interface ApiResponse {
    /**
     * The main container for all game state information.
     */
    scanning_data: ScanningData;
}

/**
 * Comprehensive game state data as seen from the perspective of a specific player.
 */
export interface ScanningData {
    /**
     * User ID of the game administrator. -1 if managed by the system.
     */
    admin: number;

    /**
     * Game configuration and settings.
     */
    config: GameConfig;

    /**
     * Base speed of fleets in the galaxy.
     */
    fleetSpeed: number;

    /**
     * Map of fleet UIDs to Fleet objects. Only contains fleets visible to the current player.
     */
    fleets: Record<string, Fleet>;

    /**
     * Whether the game has concluded.
     */
    gameOver: boolean;

    /**
     * The name of the game.
     */
    name: string;

    /**
     * Current server time (millisecond timestamp).
     */
    now: number;

    /**
     * Whether the game is currently paused.
     */
    paused: boolean;

    /**
     * The UID of the player whose perspective this data represents.
     */
    playerUid: number;

    /**
     * Map of player UIDs to Player objects.
     */
    players: Record<string, Player>;

    /**
     * Counter for the next production cycle.
     */
    productionCounter: number;

    /**
     * Rate at which production cycles occur.
     */
    productionRate: number;

    /**
     * Number of production cycles that have occurred.
     */
    productions: number;

    /**
     * Map of star UIDs to Star objects. Contains all stars in the galaxy.
     */
    stars: Record<string, Star>;

    /**
     * Number of stars required for a Fealty victory.
     */
    starsForFealty: number;

    /**
     * Number of stars required for a Victory.
     */
    starsForVictory: number;

    /**
     * Game start time (millisecond timestamp).
     */
    startTime: number;

    /**
     * Whether the game has started.
     */
    started: boolean;

    /**
     * Current game tick.
     */
    tick: number;

    /**
     * Fraction of the current tick that has elapsed.
     */
    tickFragment: number;

    /**
     * Interval between ticks in minutes.
     */
    tickRate: number;

    /**
     * Total number of stars in the galaxy.
     */
    totalStars: number;

    /**
     * Cost to perform a trade.
     */
    tradeCost: number;

    /**
     * Whether trades are visible to others? (0 or 1).
     */
    tradeScanned: 0 | 1;

    /**
     * Whether the game is turn-based (1) or real-time (0).
     */
    turnBased: 0 | 1;

    /**
     * Deadline for the current turn (if turn-based).
     */
    turnDeadline: number;

    /**
     * Map of player UIDs to their current victory points.
     */
    victoryPoints: Record<string, number>;
}

/**
 * Detailed game settings.
 */
export interface GameConfig {
    adminUserId: number;
    version: string;
    name: string;
    description: string;
    password: string;
    players: number;
    starsForVictory: number;
    sfvDecay: number;
    playerType: number;
    alliances: 0 | 1 | 2 | 3;
    fealty: 0 | 1;
    anonymity: 0 | 1;
    autoStart: 0 | 1;
    buildGates: 0 | 1;
    randomGates: 0 | 1;
    buildWorms: 0 | 1;
    randomWorms: 0 | 1;
    darkGalaxy: 0 | 1;
    starfield: string;
    starScatter: string;
    customStarfield: string;
    mirror: 0 | 1;
    turnBased: 0 | 1;
    tickRate: number;
    turnJumpTicks: number;
    turnTime: number;
    turnTimeType: number;
    starsPerPlayer: number;
    homeStarDistance: number;
    naturalResources: number;
    prodTicks: number;
    startStars: number;
    startCash: number;
    startShips: number;
    startInfEco: number;
    startInfInd: number;
    startInfSci: number;
    devCostEco: number;
    devCostInd: number;
    devCostSci: number;
    devCostGate: number;
    fleetCost: number;
    fleetInc: number;
    tradeCost: number;
    tradeScanned: 0 | 1;
    newBnk: 0 | 1;
    newRng: 0 | 1;
    expBonus: number;
    noExp: 0 | 1;
    noScn: 0 | 1;
    noTer: 0 | 1;
    resCostBnk: number;
    resCostExp: number;
    resCostRng: number;
    resCostMan: number;
    resCostScn: number;
    resCostWep: number;
    resCostTer: number;
    startTechBnk: number;
    startTechExp: number;
    startTechRng: number;
    startTechMan: number;
    startTechScn: number;
    startTechWep: number;
    startTechTer: number;
    nonDefaultSettings: string[];
    chatId: string;
}

/**
 * A star in the galaxy.
 */
export type Star = UnscannedStar | ScannedStar;

/**
 * Base properties shared by all stars.
 */
export interface BaseStar {
    /**
     * Unique ID of the star.
     */
    uid: number;
    /**
     * X coordinate in the galaxy map.
     */
    x: number;
    /**
     * Y coordinate in the galaxy map.
     */
    y: number;
    /**
     * Name of the star.
     */
    n: string;
    /**
     * Player UID of the owner.
     */
    puid: number;
    /**
     * Experience level of the star? (Used for defensive bonus in some versions).
     */
    exp: number;
}

/**
 * A star that is not currently within the scanning range of the player.
 */
export interface UnscannedStar extends BaseStar {
    /**
     * Visibility status. "0" indicates the star is not scanned.
     */
    v: "0";
}

/**
 * A star that is within scanning range, revealing its infrastructure and resources.
 */
export interface ScannedStar extends BaseStar {
    /**
     * Visibility status. 1 indicates the star is scanned.
     */
    v: 1;
    /**
     * Terraformed resources.
     */
    r: number;
    /**
     * Natural resources.
     */
    nr: number;
    /**
     * Fractional ship production progress.
     */
    yard: number;
    /**
     * Economy level.
     */
    e: number;
    /**
     * Industry level.
     */
    i: number;
    /**
     * Science level.
     */
    s: number;
    /**
     * Presence of a stargate (1) or not (0).
     */
    ga: 0 | 1;
    /**
     * Current ship strength at the star.
     */
    st: number;
}

/**
 * A fleet traveling between stars or orbiting one.
 */
export interface Fleet {
    /**
     * Unique ID of the fleet.
     */
    uid: number;
    /**
     * Player UID of the owner.
     */
    puid: number;
    /**
     * Current X coordinate.
     */
    x: number;
    /**
     * Current Y coordinate.
     */
    y: number;
    /**
     * Last X coordinate (previous tick or star).
     */
    lx: number;
    /**
     * Last Y coordinate (previous tick or star).
     */
    ly: number;
    /**
     * Experience level of the fleet.
     */
    exp: number;
    /**
     * Movement speed.
     */
    speed: number;
    /**
     * Current ship strength.
     */
    st: number;
    /**
     * UID of the star being orbited, or 0 if in transit.
     */
    ouid: number;
    /**
     * List of flight orders. Each order is [delay, starUid, action, argument].
     */
    o: [number, number, number, number][];
    /**
     * Loop orders (1 for enabled, 0 for disabled).
     */
    l: 0 | 1;
}

/**
 * Information about a player in the game.
 */
export interface Player {
    /**
     * Current cash balance.
     */
    cash: number;
    /**
     * Map of other player UIDs to diplomatic status (0: formal alliance, 1: alliance requested by us,
     * 2: alliance offered by them, 3: war).
     */
    war: Record<string, number>;
    /**
     * Countdown ticks until war starts with other players.
     */
    countdown_to_war: Record<string, number>;
    /**
     * Number of stars abandoned by this player.
     */
    starsAbandoned: number;
    /**
     * Financial ledger relative to other players.
     */
    ledger: Record<string, number>;
    /**
     * UID of the player's home star.
     */
    home: number;
    /**
     * Index of the technology currently being researched.
     */
    researching: number;
    /**
     * Index of the technology to research next.
     */
    researchingNext: number;
    /**
     * Unique ID of the player.
     */
    uid: number;
    /**
     * Player's chosen name or alias.
     */
    alias: string;
    /**
     * Avatar index.
     */
    avatar: number;
    /**
     * Race indices or characteristics.
     */
    race: [number, number];
    /**
     * Color index.
     */
    color: number;
    /**
     * Shape index.
     */
    shape: number;
    /**
     * Total number of stars owned.
     */
    totalStars: number;
    /**
     * Total number of fleets owned.
     */
    totalFleets: number;
    /**
     * Total ship strength across all stars and fleets.
     */
    totalStrength: number;
    /**
     * Total economy level.
     */
    totalEconomy: number;
    /**
     * Total industry level.
     */
    totalIndustry: number;
    /**
     * Total science level.
     */
    totalScience: number;
    /**
     * Whether the player has accepted a vassal (0 or 1).
     */
    acceptedVassal: 0 | 1;
    /**
     * List of offers of fealty received.
     */
    offersOfFealty: unknown[];
    /**
     * Map of vassal player UIDs.
     */
    vassals: Record<string, unknown>;
    /**
     * Amount of karma available to give.
     */
    karmaToGive: number;
    /**
     * Whether the player has marked themselves as ready for the next tick (turn-based).
     */
    ready: 0 | 1;
    /**
     * Number of turns missed.
     */
    missedTurns: number;
    /**
     * Status of the player (0: active, 1: quit, 2: AFK, 3: KO).
     */
    conceded: 0 | 1 | 2 | 3;
    /**
     * Whether the player is an AI (1) or human (0).
     */
    ai: 0 | 1;
    /**
     * Diplomatic regard from an AI player towards the human. 
     * The AI always trades technology if regard >= 0 and it is sent sufficient cash (at least 5 * totalEconomy).
     * Combat at the AI's stars reduces regard; gifts or combat at human stars increases it.
     */
    regard: number;
    /**
     * Map of technology indices to TechInfo objects.
     */
    tech: Record<string, TechInfo>;
}

/**
 * Information about a specific technology.
 */
export interface TechInfo {
    /**
     * Index of the technology (0: Banking, 1: Research, 2: Manufacturing, 3: Propulsion, 4: Scanning, 5: Weapons, 6: Terraforming).
     */
    kind: number;
    /**
     * Current level of the technology.
     */
    level: number;
    /**
     * Current research points accumulated towards the next level.
     */
    research: number;
    /**
     * Cost to research the next level.
     */
    cost: number;
}
