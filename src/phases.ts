/**
 * Decide em qual etapa da sessão está cada requisição. Função pura: não conhece o Pi,
 * recebe só os dados de que precisa e devolve a etapa e o novo estado do roteador.
 */

export type Phase = "first" | "work" | "compaction" | "afterCompaction";

/** Estado gravado pelo Pi no ramo da sessão (segue forks, /tree e sobrevive à compactação). */
export interface RouterState {
	/** Última compactação que já teve sua primeira resposta servida por D. */
	seenCompactionId: string | null;
	/** Etapa da última requisição roteada; usada para repetir a etapa num retry. */
	lastPhase: Phase;
	/** D foi escolhido porque o Pi ia compactar dentro desta mesma requisição. */
	pendingCompaction?: boolean;
}

export interface PhaseInput {
	reason: "user" | "continuation" | "retry" | "direct";
	state: RouterState | undefined;
	/** Já existe resposta de um modelo físico nesta conversa. */
	hasPrevious: boolean;
	/** Id da compactação mais recente no ramo atual, ou null se não houve nenhuma. */
	latestCompactionId: string | null;
	/** O Pi vai compactar antes de enviar esta requisição (limite estourado para o modelo D). */
	compactionImminent: boolean;
}

export interface PhaseDecision {
	phase: Phase;
	/** Novo estado, ou undefined quando não mudou (evita gravar entradas repetidas). */
	state?: RouterState;
}

export function decidePhase(input: PhaseInput): PhaseDecision {
	const { reason, state, latestCompactionId } = input;
	if (reason === "direct") return { phase: "compaction" };

	if (!state) {
		const phase: Phase = input.hasPrevious ? "work" : "first";
		return { phase, state: { seenCompactionId: latestCompactionId, lastPhase: phase } };
	}

	let phase: Phase;
	const newCompaction = latestCompactionId !== state.seenCompactionId;
	if (state.pendingCompaction) {
		// A compactação prevista já foi atendida por D; só um retry dessa mesma requisição fica em D.
		phase = reason === "retry" ? state.lastPhase : "work";
	} else if (newCompaction) {
		phase = "afterCompaction";
	} else if (input.compactionImminent) {
		return { phase: "afterCompaction", state: { ...state, lastPhase: "afterCompaction", pendingCompaction: true } };
	} else if (reason === "retry") {
		phase = state.lastPhase;
	} else {
		phase = "work";
	}

	const next: RouterState = { seenCompactionId: latestCompactionId, lastPhase: phase };
	const same =
		next.seenCompactionId === state.seenCompactionId && next.lastPhase === state.lastPhase && !state.pendingCompaction;
	return same ? { phase } : { phase, state: next };
}
