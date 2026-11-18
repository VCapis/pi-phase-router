import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig, pickModel, splitRef } from "../src/config.ts";

test("aceita string ou lista e preenche etapas ausentes com work", () => {
	const c = parseConfig({ models: { first: "a/x", work: ["b/y", "b/z"] } });
	assert.deepEqual(c.models.first, ["a/x"]);
	assert.deepEqual(c.models.work, ["b/y", "b/z"]);
	assert.deepEqual(c.models.compaction, ["b/y", "b/z"]);
	assert.deepEqual(c.models.afterCompaction, ["b/y", "b/z"]);
	assert.equal(c.provider, "phase");
	assert.equal(c.id, "router");
});

test("work é obrigatório", () => {
	assert.throws(() => parseConfig({ models: { first: "a/x" } }), /work/);
});

test("rejeita referência sem provedor", () => {
	assert.throws(() => parseConfig({ models: { work: "semprovedor" } }), /provider\/model/);
});

test("rejeita nível de raciocínio inválido", () => {
	assert.throws(() => parseConfig({ models: { work: "a/b" }, thinkingLevel: { work: "turbo" } }), /thinkingLevel/);
});

test("splitRef corta só na primeira barra (ids com barra, como no OpenRouter)", () => {
	assert.deepEqual(splitRef("openrouter/anthropic/claude-x"), { provider: "openrouter", id: "anthropic/claude-x" });
});

test("pickModel escolhe o primeiro modelo disponível", () => {
	const ok = new Set(["b/2", "b/3"]);
	assert.equal(pickModel(["a/1", "b/2", "b/3"], (r) => ok.has(r)), "b/2");
});

test("pickModel no retry pula para o próximo depois do que falhou", () => {
	assert.equal(pickModel(["a/1", "b/2", "c/3"], () => true, "a/1"), "b/2");
});

test("pickModel no retry sem alternativa repete o que falhou", () => {
	assert.equal(pickModel(["a/1"], () => true, "a/1"), "a/1");
});

test("pickModel sem nenhum disponível retorna undefined", () => {
	assert.equal(pickModel(["a/1"], () => false), undefined);
});
