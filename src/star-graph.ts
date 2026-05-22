import type { Player, Star, TechInfo } from "./types.js";
import { intrinsicStarValue } from "./star-value.js";

const TECH = {
    PROPULSION: 3,
} as const;

export interface StarNode {
    uid: number;
    name: string;
    ownerUid: number;
    x: number;
    y: number;
    naturalResources: number;
    industry: number;
    science: number;
    valueScore: number;
}

export function starNode(star: Star): StarNode {
    return {
        uid: star.uid,
        name: star.n,
        ownerUid: star.puid,
        x: star.x,
        y: star.y,
        naturalResources: safeNumber((star as { nr?: unknown }).nr, 0),
        industry: safeNumber((star as { i?: unknown }).i, 0),
        science: safeNumber((star as { s?: unknown }).s, 0),
        valueScore: intrinsicStarValue(star),
    };
}

export function starDistance(a: Pick<Star, "x" | "y">, b: Pick<Star, "x" | "y">) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function travelTicks(distance: number, speed: number) {
    return distance / Math.max(speed, 0.0001);
}

export function playerRange(player: Player | undefined) {
    if (!player) return 0;
    return 0.5 + techLevel(player, TECH.PROPULSION) * 0.125;
}

function techLevel(player: Player | undefined, kind: number) {
    return safeNumber((player?.tech[String(kind)] as TechInfo | undefined)?.level, 1);
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
