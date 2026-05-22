import type { Star } from "./types.js";

export interface StarValueWeights {
    naturalResources: number;
    industry: number;
    science: number;
}

export const DEFAULT_STAR_VALUE_WEIGHTS: StarValueWeights = {
    naturalResources: 1,
    industry: 3,
    science: 5,
};

export function intrinsicStarValue(star: Star, weights: StarValueWeights = DEFAULT_STAR_VALUE_WEIGHTS) {
    const naturalResources = safeNumber((star as { nr?: unknown }).nr, 0);
    const industry = safeNumber((star as { i?: unknown }).i, 0);
    const science = safeNumber((star as { s?: unknown }).s, 0);
    return naturalResources * weights.naturalResources
        + industry * weights.industry
        + science * weights.science;
}

function safeNumber(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
