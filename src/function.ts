import { runTurn, type TurnConfig } from "./run-turn.js";

interface HttpResponseLike {
    status(code: number): HttpResponseLike;
    json(body: unknown): void;
}

export async function scheduledTurn(_request?: unknown, response?: HttpResponseLike) {
    try {
        const result = await runTurn(configFromEnv());
        if (response) {
            response.status(200).json(result);
        } else {
            console.log(JSON.stringify(result));
        }
        return result;
    } catch (error) {
        const body = {
            error: error instanceof Error ? error.message : String(error),
        };
        if (response) {
            response.status(500).json(body);
        } else {
            console.error(JSON.stringify(body));
        }
        throw error;
    }
}

function configFromEnv(): TurnConfig {
    const baseUrl = process.env.NP_BASE_URL ?? "https://np4.ironhelmet.com";
    const gameId = requiredEnv("NP_GAME_ID");
    const apiKey = process.env.NP_API_KEY;
    const user = process.env.NP_USER;
    const password = process.env.NP_PASSWD ?? process.env.NP_PASSWORD;

    const scan: TurnConfig["scan"] = {
        baseUrl,
        gameId,
    };
    if (apiKey) scan.apiKey = apiKey;

    const config: TurnConfig = {
        scan,
        submit: process.env.AIB_SUBMIT === "1",
        planner: {
            horizonTicks: numberFromEnv("AIB_HORIZON_TICKS", 30),
            cashReserveRatio: numberFromEnv("AIB_CASH_RESERVE_RATIO", 0.2),
            buildCarrier: process.env.AIB_BUILD_CARRIER !== "0",
            markReady: process.env.AIB_MARK_READY === "1",
        },
    };
    const gemini = geminiConfig();
    if (gemini) config.gemini = gemini;

    if (user && password) {
        config.account = {
            baseUrl,
            user,
            password,
            gameId,
            version: process.env.NP_VERSION ?? "np4",
        };
    }

    return config;
}

function geminiConfig() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return undefined;
    return {
        apiKey,
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    };
}

function requiredEnv(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function numberFromEnv(name: string, fallback: number) {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
