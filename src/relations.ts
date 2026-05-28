import type { ScanningData } from "./types.js";

export const DIPLOMACY_STATUS = {
    ALLIED: 0,
    REQUESTED: 1,
    OFFERED: 2,
    WAR: 3,
} as const;

export function activePlayer(scan: ScanningData, playerUid: number) {
    const player = scan.players[String(playerUid)];
    return player !== undefined && player.totalStars > 0;
}

export function alliancesEnabled(scan: ScanningData) {
    return Number(scan.config.alliances) > 0;
}

export function diplomacyStatus(scan: ScanningData, playerUid: number) {
    const player = scan.players[String(scan.playerUid)];
    return numeric(player?.war?.[String(playerUid)]);
}

export function isFormalAlly(scan: ScanningData, playerUid: number) {
    return playerUid !== scan.playerUid
        && alliancesEnabled(scan)
        && diplomacyStatus(scan, playerUid) === DIPLOMACY_STATUS.ALLIED;
}

export function hasRequestedAlliance(scan: ScanningData, playerUid: number) {
    return alliancesEnabled(scan)
        && diplomacyStatus(scan, playerUid) === DIPLOMACY_STATUS.REQUESTED;
}

export function hasAllianceOfferFrom(scan: ScanningData, playerUid: number) {
    return alliancesEnabled(scan)
        && diplomacyStatus(scan, playerUid) === DIPLOMACY_STATUS.OFFERED;
}

export function isEnemyPlayer(scan: ScanningData, playerUid: number) {
    return playerUid !== scan.playerUid
        && activePlayer(scan, playerUid)
        && !isFormalAlly(scan, playerUid);
}

function numeric(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
