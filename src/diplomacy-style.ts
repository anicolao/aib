import type { DecisionRecord, DiplomacyDraft, DiplomacyJudgementCandidate } from "./planner.js";

export interface GeminiConfig {
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

export async function flavorDiplomacyDrafts(
    decision: DecisionRecord,
    config?: GeminiConfig,
    judgementCandidates: DiplomacyJudgementCandidate[] = [],
): Promise<DecisionRecord> {
    if (!config?.apiKey) {
        return decision;
    }

    const judgedDecision = judgementCandidates.length > 0
        ? await addJudgedDiplomacyDrafts(decision, judgementCandidates, config)
        : decision;
    if (judgedDecision.diplomacyDrafts.length === 0) {
        return judgedDecision;
    }
    const persona = personaFor(config.gameId, decision.metadata.playerUid);
    const diplomacyDrafts = await Promise.all(
        judgedDecision.diplomacyDrafts.map((draft) => flavorDraft(draft, persona, config)),
    );
    return {
        ...judgedDecision,
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
    if (draft.skipFlavor) {
        return draft;
    }
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

async function addJudgedDiplomacyDrafts(
    decision: DecisionRecord,
    candidates: DiplomacyJudgementCandidate[],
    config: GeminiConfig,
): Promise<DecisionRecord> {
    const assessments = await Promise.all(candidates.map((candidate) => assessInboundDiplomacy(candidate, config)));
    const addedDrafts: DiplomacyDraft[] = [];
    const rejected = [...decision.rejected];
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        const assessment = assessments[index];
        if (!candidate || !assessment) continue;
        if ("error" in assessment) {
            rejected.push(`LLM diplomacy judgement failed for ${candidate.recipientAlias}: ${assessment.error}`);
            continue;
        }
        if (!assessment.shouldRespond) {
            rejected.push(`LLM diplomacy judgement skipped ${candidate.recipientAlias}: ${assessment.reason}`);
            continue;
        }
        const draft: DiplomacyDraft = {
            recipientUid: candidate.recipientUid,
            recipientAlias: candidate.recipientAlias,
            recipientColor: candidate.recipientColor,
            fromColor: candidate.fromColor,
            friendly: candidate.friendly,
            subject: candidate.subject,
            body: assessment.body,
            reason: `LLM judged inbound diplomacy from ${candidate.recipientAlias} needs response: ${assessment.reason}`,
            context: candidate.context,
        };
        if (candidate.threadKey) draft.threadKey = candidate.threadKey;
        addedDrafts.push(draft);
    }
    if (addedDrafts.length === 0 && rejected.length === decision.rejected.length) {
        return decision;
    }
    return {
        ...decision,
        summary: {
            ...decision.summary,
            diplomacyDraftsPlanned: decision.summary.diplomacyDraftsPlanned + addedDrafts.length,
        },
        diplomacyDrafts: [...decision.diplomacyDrafts, ...addedDrafts],
        rejected,
    };
}

async function assessInboundDiplomacy(candidate: DiplomacyJudgementCandidate, config: GeminiConfig): Promise<JudgementResult | { error: string }> {
    try {
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
                        parts: [{ text: judgementPrompt(candidate) }],
                    },
                ],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 512,
                    responseMimeType: "application/json",
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
        if (!output) throw new Error("Gemini returned no judgement text");
        return parseJudgement(output);
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
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
- Preserve the same intent and any concrete agreement from the plain draft.
- If thread context is provided, respond to the other player's latest concrete proposal instead of restating a generic desire to trade.
- Lines labeled "Us" are our previous messages; use them only as background and do not answer or address them.
- Address only ${draft.recipientAlias}. Do not write as if replying to multiple participants.
- Do not add tactical claims, threats, promises, alliances, or game actions that are not in the plain draft.
- Neptune's Pride hyperlinks player and star names with double brackets. Preserve existing [[Name]] link tokens, and enclose any player or star name you mention as [[Name]].
- Do not ask for in-flight carriers to be recalled, redirected, diverted, turned around, or stopped. Once launched, carriers cannot be redirected; ask instead for no reinforcements, no follow-up attacks, compensation, or border talks when that matches the plain draft.
- Do not mention Star Wars, Star Trek, any franchise, or any named character.
- Keep it concise: under 140 words.
- Return only the message body text. No markdown, no subject line, no commentary, no code block.

Thread context, oldest to newest:
${draft.context ?? "No prior thread context."}

Plain body:
${draft.body}`;
}

function judgementPrompt(candidate: DiplomacyJudgementCandidate) {
    return `Assess this Neptune's Pride diplomacy thread and decide whether we should respond now.

Use judgement. A response is warranted when the other player proposes or requests a concrete change, asks a direct question that affects coordination, suggests a trade/research plan, asks us to change research, proposes borders/peace/compensation, or raises an objection needing an answer.

Do not respond just to thanks, appreciation, vague goodwill, repeated generic trade chatter, or a message that only restates an agreement already made.

If responding, write a concise plain draft that answers the latest inbound message specifically. It may agree, disagree, propose an alternative, or ask one clarifying question. Do not invent promises, alliances, threats, tech transfers, or military actions not supported by the context. Do not claim, request, or imply that in-flight carriers can be recalled, redirected, diverted, turned around, or stopped; once launched, carriers cannot be redirected. When discussing attacks, ask instead for no reinforcements, no follow-up attacks, compensation, or border talks. Use Neptune's Pride links with [[ ]] around player and star names. Address only [[${candidate.recipientAlias}]].

Our current planned research: ${candidate.plannedResearchName}

Thread context, oldest to newest:
${candidate.context}

Latest inbound message:
${candidate.latestInboundBody}

Return strict JSON only with this shape:
{
  "shouldRespond": true,
  "reason": "short reason",
  "subject": "unused; set to an empty string",
  "body": "message body if shouldRespond is true, otherwise empty string"
}`;
}

function parseJudgement(output: string): JudgementResult {
    const parsed = JSON.parse(stripJsonFence(output)) as Partial<JudgementResult>;
    const shouldRespond = parsed.shouldRespond === true;
    const reason = cleanOneLine(typeof parsed.reason === "string" ? parsed.reason : "no reason provided", 180);
    const subject = cleanOneLine(typeof parsed.subject === "string" && parsed.subject.trim() ? parsed.subject : "Re: tech cooperation", 80);
    const body = typeof parsed.body === "string" ? cleanBody(parsed.body) : "";
    if (shouldRespond && !body) {
        throw new Error("Gemini judgement requested a response without a body");
    }
    return { shouldRespond, reason, subject, body };
}

function stripJsonFence(value: string) {
    return value
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
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

interface JudgementResult {
    shouldRespond: boolean;
    reason: string;
    subject: string;
    body: string;
}
