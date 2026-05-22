import type { DecisionRecord, DiplomacyDraft } from "./planner.js";

interface GeminiConfig {
    apiKey: string;
    model: string;
    gameId: string;
}

interface Persona {
    label: string;
    guidance: string;
}

const PERSONAS: Persona[] = [
    {
        label: "space-opera frontier hero",
        guidance: "principled, warm, plainspoken, hopeful, and brave; avoid named franchise references",
    },
    {
        label: "space-opera imperial villain",
        guidance: "polished, controlled, ambitious, and faintly ominous without making threats; avoid named franchise references",
    },
    {
        label: "starship federation hero",
        guidance: "diplomatic, curious, principled, and cooperative; avoid named franchise references",
    },
    {
        label: "starship tyrant villain",
        guidance: "grand, strategic, formal, and charismatic without sounding hostile; avoid named franchise references",
    },
];

export async function flavorDiplomacyDrafts(decision: DecisionRecord, config?: GeminiConfig): Promise<DecisionRecord> {
    if (!config?.apiKey || decision.diplomacyDrafts.length === 0) {
        return decision;
    }

    const persona = personaFor(config.gameId, decision.metadata.playerUid);
    const diplomacyDrafts = await Promise.all(
        decision.diplomacyDrafts.map((draft) => flavorDraft(draft, persona, config)),
    );
    return {
        ...decision,
        diplomacyDrafts,
    };
}

function personaFor(gameId: string, playerUid: number) {
    const persona = PERSONAS[(seedValue(gameId) + playerUid) % PERSONAS.length];
    if (!persona) throw new Error("No diplomacy personas are configured");
    return persona;
}

function seedValue(value: string) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.trunc(numeric);
    let hash = 0;
    for (const char of value) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash;
}

async function flavorDraft(draft: DiplomacyDraft, persona: Persona, config: GeminiConfig): Promise<DiplomacyDraft> {
    try {
        const generated = await generateFlavor(draft, persona, config);
        return {
            ...draft,
            subject: generated.subject,
            body: generated.body,
            persona: persona.label,
            plainSubject: draft.subject,
            plainBody: draft.body,
        };
    } catch (error) {
        return {
            ...draft,
            persona: persona.label,
            flavorError: error instanceof Error ? error.message : String(error),
        };
    }
}

async function generateFlavor(draft: DiplomacyDraft, persona: Persona, config: GeminiConfig) {
    const response = await fetch(geminiUrl(config), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
            contents: [
                {
                    role: "user",
                    parts: [{ text: promptFor(draft, persona) }],
                },
            ],
            generationConfig: {
                temperature: 0.8,
                maxOutputTokens: 512,
                thinkingConfig: {
                    thinkingBudget: 0,
                },
            },
        }),
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const parsed = JSON.parse(text) as GeminiResponse;
    const output = parsed.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!output) {
        throw new Error("Gemini returned no text");
    }

    return {
        subject: cleanOneLine(draft.subject, 80),
        body: cleanBody(output),
    };
}

function geminiUrl(config: GeminiConfig) {
    const model = config.model.replace(/^models\//, "");
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function promptFor(draft: DiplomacyDraft, persona: Persona) {
    return `Rewrite this Neptune's Pride diplomacy draft into a more flavorful message body.

Persona archetype: ${persona.label}
Voice guidance: ${persona.guidance}

Hard requirements:
- Preserve the same intent: friendly neighbor outreach, disclose current research, propose mutually profitable tech trading, and invite their research/trade preferences.
- Do not add tactical claims, threats, promises, alliances, or game actions that are not in the plain draft.
- Do not mention Star Wars, Star Trek, any franchise, or any named character.
- Keep it concise: under 140 words.
- Return only the message body text. No markdown, no subject line, no commentary, no code block.

Plain body:
${draft.body}`;
}

function cleanOneLine(value: string, maxLength: number) {
    return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBody(value: string) {
    return value.trim();
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
            }>;
        };
    }>;
}
