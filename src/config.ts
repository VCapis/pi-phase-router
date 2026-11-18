import type { Phase } from "./phases.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface RouterConfig {
	provider: string;
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
	/** Lista de "provedor/modelo" por etapa, em ordem de preferência (fallback). */
	models: Record<Phase, string[]>;
	/** Nível de raciocínio fixo por etapa; sem valor, repassa o nível escolhido no /model. */
	thinkingLevel: Partial<Record<Phase, ThinkingLevel>>;
}

const PHASES: Phase[] = ["first", "work", "compaction", "afterCompaction"];

export function splitRef(ref: string): { provider: string; id: string } {
	const slash = ref.indexOf("/");
	return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

function toList(value: unknown, phase: string): string[] | undefined {
	if (value === undefined) return undefined;
	const list = typeof value === "string" ? [value] : value;
	if (!Array.isArray(list) || list.length === 0) throw new Error(`models.${phase}: use "provider/model" ou uma lista`);
	for (const ref of list) {
		if (typeof ref !== "string" || ref.indexOf("/") <= 0 || ref.endsWith("/")) {
			throw new Error(`models.${phase}: "${ref}" não está no formato provider/model`);
		}
	}
	return list;
}

export function parseConfig(raw: unknown): RouterConfig {
	const obj = (raw ?? {}) as Record<string, any>;
	const models = (obj.models ?? {}) as Record<string, unknown>;
	const work = toList(models.work, "work");
	if (!work) throw new Error("models.work é obrigatório (modelo B)");

	const resolved = {} as Record<Phase, string[]>;
	for (const phase of PHASES) resolved[phase] = toList(models[phase], phase) ?? work;

	const thinkingLevel: Partial<Record<Phase, ThinkingLevel>> = {};
	for (const [phase, level] of Object.entries(obj.thinkingLevel ?? {})) {
		if (!PHASES.includes(phase as Phase) || !THINKING_LEVELS.includes(level as ThinkingLevel)) {
			throw new Error(`thinkingLevel.${phase}: valor inválido "${level}"`);
		}
		thinkingLevel[phase as Phase] = level as ThinkingLevel;
	}

	return {
		provider: obj.provider ?? "phase",
		id: obj.id ?? "router",
		name: obj.name ?? "Phase router",
		contextWindow: obj.contextWindow,
		maxTokens: obj.maxTokens,
		models: resolved,
		thinkingLevel,
	};
}

/**
 * Escolhe o primeiro modelo disponível da lista. Num retry, começa depois do modelo que falhou;
 * se não houver outro disponível, repete o que falhou.
 */
export function pickModel(list: string[], available: (ref: string) => boolean, failed?: string): string | undefined {
	const start = failed ? list.indexOf(failed) + 1 : 0;
	const candidates = failed && start > 0 ? [...list.slice(start), ...list.slice(0, start)] : list;
	return candidates.find(available);
}
