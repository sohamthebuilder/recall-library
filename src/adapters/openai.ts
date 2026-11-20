import {
  AiError,
  type AiAdapter,
  type ConfirmTopicMatchInput,
  type ProposeTopicsInput,
  type TopicCandidate,
} from "@/core/ports/ai";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";

/**
 * The real AI adapter: OpenAI over its REST API (no SDK). Each core AI call is one request
 * with a JSON-schema response format, so replies are parsed, never scraped.
 *
 * Env: OPENAI_API_KEY (required), OPENAI_MODEL (default below), OPENAI_EMBEDDING_MODEL
 * (default text-embedding-3-small; must produce EMBEDDING_DIMENSIONS-long vectors).
 */
export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
/** Topic proposal sees at most this much text; PDFs narrow it further by chapter selection. */
const MAX_PROPOSAL_CHARS = 120_000;

export function createOpenAiAdapter(options: OpenAiOptions): AiAdapter {
  const model = options.model || DEFAULT_MODEL;
  const embeddingModel = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  const doFetch = options.fetch ?? fetch;

  async function post<T>(path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AiError("Could not reach the AI service. Try again.");
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`OpenAI ${path} failed: ${res.status} ${detail.slice(0, 500)}`);
      throw new AiError(
        res.status === 429 ? "The AI service is busy or out of credit. Try again later." : "The AI service failed. Try again.",
      );
    }
    return (await res.json()) as T;
  }

  async function structured<T>(name: string, schema: object, system: string, user: string): Promise<T> {
    const res = await post<{ choices: { message: { content: string | null; refusal?: string | null } }[] }>(
      "/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      },
    );
    const content = res.choices[0]?.message.content;
    if (!content) throw new AiError("The AI service gave no answer. Try again.");
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new AiError("The AI service gave an unreadable answer. Try again.");
    }
  }

  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      const res = await post<{ data: { index: number; embedding: number[] }[] }>("/embeddings", {
        model: embeddingModel,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },

    async proposeTopics({ sourceTitle, text }: ProposeTopicsInput): Promise<TopicCandidate[]> {
      const result = await structured<{ topics: { name: string; description: string }[] }>(
        "topics",
        {
          type: "object",
          additionalProperties: false,
          required: ["topics"],
          properties: {
            topics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "description"],
                properties: { name: { type: "string" }, description: { type: "string" } },
              },
            },
          },
        },
        [
          "You help a learner turn content they read or watched into Topics to remember.",
          "A Topic is one unit of knowledge worth explaining and being tested on, e.g. 'Kafka consumer groups'.",
          "List the distinct Topics this content covers in substance (not passing mentions).",
          "Prefer fewer, meaningful Topics: usually 1-6 for an article or note, more only for long material.",
          "Names: short, specific noun phrases in Title case, without the source's name.",
          "Description: one sentence saying what the Topic is about.",
        ].join("\n"),
        `${sourceTitle ? `Title: ${sourceTitle}\n\n` : ""}${text.slice(0, MAX_PROPOSAL_CHARS)}`,
      );
      return result.topics.map((t) => ({ name: t.name, description: t.description || null }));
    },

    async confirmTopicMatch({ candidate, existing }: ConfirmTopicMatchInput): Promise<string | null> {
      const result = await structured<{ match: number }>(
        "topic_match",
        {
          type: "object",
          additionalProperties: false,
          required: ["match"],
          properties: { match: { type: "integer" } },
        },
        [
          "Decide whether a proposed Topic is the same Topic as one the learner already has.",
          "Same Topic means studying one would cover the other; related or broader/narrower Topics are NOT the same.",
          "Answer with the number of the matching existing Topic, or 0 if none is the same.",
        ].join("\n"),
        [
          `Proposed: ${describe(candidate)}`,
          "Existing:",
          ...existing.map((t, i) => `${i + 1}. ${describe(t)}`),
        ].join("\n"),
      );
      return existing[result.match - 1]?.id ?? null;
    },
  };
}

function describe(t: { name: string; description: string | null }): string {
  return t.description ? `${t.name} (${t.description})` : t.name;
}

/** The adapter configured from the environment. */
export function openAiFromEnv(): AiAdapter {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const missing = async (): Promise<never> => {
      throw new AiError("The AI service is not configured (OPENAI_API_KEY is not set).");
    };
    return { embed: missing, proposeTopics: missing, confirmTopicMatch: missing };
  }
  return createOpenAiAdapter({
    apiKey,
    model: process.env.OPENAI_MODEL,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
  });
}
