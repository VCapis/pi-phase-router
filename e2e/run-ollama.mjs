// Teste ponta a ponta com o Ollama local. Não usa nem altera o ~/.pi do usuário.
//
//   node e2e/run-ollama.mjs <caminho-do-cli.js-do-pi>
//
// Cria um diretório de agente temporário com quatro provedores (olA, olB, olC, olD) que apontam
// para o mesmo Ollama, para que cada etapa apareça com um nome diferente nas respostas.
// Sequência: prompt com ferramenta (A, depois B) -> prompt (B) -> /compact (C) -> prompt (D) -> prompt (B).

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const piCli = process.argv[2];
if (!piCli) throw new Error("uso: node e2e/run-ollama.mjs <cli.js do pi>");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "phase-router-e2e-"));
const agentDir = join(work, "agent");
const project = join(work, "project");
mkdirSync(agentDir, { recursive: true });
mkdirSync(project, { recursive: true });
writeFileSync(join(project, "notas.txt"), "linha um\nlinha dois\nlinha três\n");

const ollama = (id) => ({
	baseUrl: "http://localhost:11434/v1",
	api: "openai-completions",
	apiKey: "ollama",
	models: [{ id, contextWindow: 32768, maxTokens: 2048 }],
});
writeFileSync(
	join(agentDir, "models.json"),
	JSON.stringify({
		providers: { olA: ollama("qwen3:8b"), olB: ollama("qwen3:8b"), olC: ollama("gemma3:4b"), olD: ollama("qwen3:8b") },
	}),
);
writeFileSync(
	join(agentDir, "phase-router.json"),
	JSON.stringify({
		models: {
			first: ["semcredencial/modelo-x", "olA/qwen3:8b"], // o primeiro não existe: testa o fallback
			work: "olB/qwen3:8b",
			compaction: "olC/gemma3:4b",
			afterCompaction: "olD/qwen3:8b",
		},
	}),
);
// Guarda pouco contexto recente para a sessão curta do teste ter o que compactar.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 200 } }));
const log = join(work, "routes.jsonl");

const pi = spawn(
	process.execPath,
	[piCli, "--mode", "rpc", "--model", "phase/router", "--thinking", "off", "-e", join(root, "src", "index.ts")],
	{ cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_PHASE_ROUTER_LOG: log, PI_OFFLINE: "1" } },
);
pi.stderr.on("data", (d) => process.stderr.write(d));

const waiters = [];
const answered = [];
let buffer = "";
pi.stdout.on("data", (chunk) => {
	buffer += chunk;
	let nl;
	while ((nl = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, nl).trim();
		buffer = buffer.slice(nl + 1);
		if (!line) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			const m = event.message;
			answered.push(`${m.provider}/${m.model}${m.stopReason === "error" ? ` ERRO: ${m.errorMessage}` : ""}`);
		}
		for (const w of [...waiters]) {
			if (w.match(event)) {
				waiters.splice(waiters.indexOf(w), 1);
				w.resolve(event);
			}
		}
	}
});

function waitFor(match, ms = 300_000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("tempo esgotado")), ms);
		waiters.push({ match, resolve: (e) => (clearTimeout(timer), resolve(e)) });
	});
}
const send = (cmd) => pi.stdin.write(`${JSON.stringify(cmd)}\n`);

async function prompt(text) {
	const settled = waitFor((e) => e.type === "agent_settled");
	send({ type: "prompt", message: text });
	await settled;
	console.log(`> ${text}\n  respostas: ${answered.splice(0).join(" | ")}`);
}

try {
	await prompt("Use a ferramenta read para ler notas.txt e diga quantas linhas o arquivo tem. Responda curto.");
	await prompt("Agora diga só a segunda linha.");
	const compacted = waitFor((e) => e.type === "response" && e.command === "compact");
	send({ type: "compact" });
	const res = await compacted;
	console.log(`> /compact  sucesso=${res.success} ${res.error ?? ""}`);
	await prompt("Qual era o nome do arquivo que você leu? Responda curto.");
	await prompt("Obrigado. Responda só: ok.");
} finally {
	pi.kill();
}

console.log("\nRotas registradas pela extensão:");
console.log(readFileSync(log, "utf8"));
