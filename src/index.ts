/**
 * pi-phase-router: modelo virtual que usa um modelo diferente em cada etapa da sessão.
 *
 *   first            primeira resposta de uma sessão nova            (A)
 *   work             ferramentas, continuações e o resto da sessão    (B)
 *   compaction       resumo da compactação                            (C)
 *   afterCompaction  primeira resposta depois de uma compactação      (D)
 *
 * Uso: selecione `phase/router` no /model (ou `pi --model phase/router`).
 * Configuração: veja o README.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseConfig, pickModel, type RouterConfig, splitRef } from "./config.ts";
import { decidePhase, type Phase, type RouterState } from "./phases.ts";

const CONFIG_FILE = "phase-router.json";

function findConfigFile(): string | undefined {
	const candidates = [
		process.env.PI_PHASE_ROUTER_CONFIG,
		join(process.cwd(), ".pi", CONFIG_FILE),
		join(getAgentDir(), CONFIG_FILE),
	];
	return candidates.find((path) => path && existsSync(path));
}

function refOf(model: { provider: string; id: string } | undefined): string | undefined {
	return model ? `${model.provider}/${model.id}` : undefined;
}

function latestCompactionId(ctx: ExtensionContext): string | null {
	const branch = ctx.sessionManager.getBranch();
	return branch.findLast((entry) => entry.type === "compaction")?.id ?? null;
}

export default function (pi: ExtensionAPI) {
	const path = findConfigFile();
	let config: RouterConfig | undefined;
	let configError: string | undefined;
	try {
		if (!path) throw new Error(`arquivo ${CONFIG_FILE} não encontrado`);
		config = parseConfig(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		configError = `phase-router desativado: ${error instanceof Error ? error.message : String(error)}`;
	}

	if (!config) {
		pi.on("session_start", async (_event, ctx) => ctx.ui.notify(configError!, "warning"));
		return;
	}
	const cfg = config;
	const debugLog = process.env.PI_PHASE_ROUTER_LOG;

	/** Repete a regra do Pi: compacta se os tokens passam de contextWindow - reserveTokens do modelo roteado. */
	function wouldCompact(ctx: ExtensionContext, ref: string | undefined): boolean {
		if (!ref) return false;
		const { provider, id } = splitRef(ref);
		const model = ctx.modelRegistry.find(provider, id);
		const tokens = ctx.getContextUsage()?.tokens;
		if (!model || model.contextWindow <= 0 || tokens == null) return false;
		const compaction = (pi.getSettings() as any).compaction ?? {};
		if (compaction.enabled === false) return false;
		const override = compaction.modelOverrides?.[`${cfg.provider}/${cfg.id}`]?.reserveTokens;
		const reserve = override ?? compaction.reserveTokens ?? 16384;
		return tokens > model.contextWindow - reserve;
	}

	pi.registerVirtualModel<RouterState>({
		provider: cfg.provider,
		id: cfg.id,
		name: cfg.name,
		thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
		contextWindow: cfg.contextWindow,
		maxTokens: cfg.maxTokens,
		route(request, ctx) {
			const available = (ref: string) => {
				const { provider, id } = splitRef(ref);
				const model = ctx.modelRegistry.find(provider, id);
				return !!model && ctx.modelRegistry.hasConfiguredAuth(model);
			};
			const failed = request.reason === "retry" ? refOf(request.failed?.model) : undefined;
			const isDirect = request.reason === "direct";

			const decision = decidePhase({
				reason: request.reason,
				state: request.state,
				hasPrevious: !!request.previous,
				latestCompactionId: isDirect ? null : latestCompactionId(ctx),
				compactionImminent:
					!isDirect && !!request.state && wouldCompact(ctx, pickModel(cfg.models.afterCompaction, available)),
			});

			const phase: Phase = decision.phase;
			const ref = pickModel(cfg.models[phase], available, failed);
			if (!ref) {
				throw new Error(`phase-router: nenhum modelo com credenciais para a etapa ${phase}: ${cfg.models[phase].join(", ")}`);
			}
			const { provider, id } = splitRef(ref);
			const model = ctx.modelRegistry.find(provider, id)!;

			if (debugLog) {
				appendFileSync(
					debugLog,
					`${JSON.stringify({ t: new Date().toISOString(), reason: request.reason, phase, model: ref, failed, state: decision.state ?? request.state })}\n`,
				);
			}
			if (ctx.hasUI) ctx.ui.setStatus("phase-router", `etapa: ${phase}`);

			return {
				model,
				thinkingLevel: cfg.thinkingLevel[phase] ?? request.thinkingLevel,
				state: decision.state,
			};
		},
	});
}
