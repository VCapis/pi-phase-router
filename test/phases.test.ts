import assert from "node:assert/strict";
import { test } from "node:test";
import { decidePhase, type RouterState } from "../src/phases.ts";

const base = {
	hasPrevious: false,
	latestCompactionId: null as string | null,
	compactionImminent: false,
};

test("primeira requisição de uma sessão nova vai para a etapa first (A)", () => {
	const d = decidePhase({ ...base, reason: "user", state: undefined });
	assert.equal(d.phase, "first");
	assert.deepEqual(d.state, { seenCompactionId: null, lastPhase: "first" });
});

test("trocar para o roteador no meio de uma sessão existente não volta para A", () => {
	const d = decidePhase({ ...base, reason: "user", state: undefined, hasPrevious: true });
	assert.equal(d.phase, "work");
});

test("continuação depois da primeira resposta vai para work (B)", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "first" };
	const d = decidePhase({ ...base, reason: "continuation", state, hasPrevious: true });
	assert.equal(d.phase, "work");
	assert.deepEqual(d.state, { seenCompactionId: null, lastPhase: "work" });
});

test("nova mensagem do usuário no meio da sessão continua em work (B)", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "work" };
	const d = decidePhase({ ...base, reason: "user", state, hasPrevious: true });
	assert.equal(d.phase, "work");
	assert.equal(d.state, undefined, "estado igual não deve ser regravado");
});

test("requisição direta (resumo da compactação) vai para compaction (C) sem estado", () => {
	const d = decidePhase({ ...base, reason: "direct", state: undefined });
	assert.equal(d.phase, "compaction");
	assert.equal(d.state, undefined);
});

test("primeira requisição depois de uma compactação nova vai para afterCompaction (D)", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "work" };
	const d = decidePhase({ ...base, reason: "user", state, hasPrevious: true, latestCompactionId: "c1" });
	assert.equal(d.phase, "afterCompaction");
	assert.deepEqual(d.state, { seenCompactionId: "c1", lastPhase: "afterCompaction" });
});

test("depois de D, a sessão volta para work (B)", () => {
	const state: RouterState = { seenCompactionId: "c1", lastPhase: "afterCompaction" };
	const d = decidePhase({ ...base, reason: "continuation", state, hasPrevious: true, latestCompactionId: "c1" });
	assert.equal(d.phase, "work");
});

test("compactação iminente dentro da requisição já manda para D e marca pendência", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "work" };
	const d = decidePhase({ ...base, reason: "continuation", state, hasPrevious: true, compactionImminent: true });
	assert.equal(d.phase, "afterCompaction");
	assert.deepEqual(d.state, { seenCompactionId: null, lastPhase: "afterCompaction", pendingCompaction: true });
});

test("a compactação prevista é absorvida: a requisição seguinte vai para B, não para D de novo", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "afterCompaction", pendingCompaction: true };
	const d = decidePhase({ ...base, reason: "continuation", state, hasPrevious: true, latestCompactionId: "c1" });
	assert.equal(d.phase, "work");
	assert.deepEqual(d.state, { seenCompactionId: "c1", lastPhase: "work" });
});

test("retry repete a etapa da requisição que falhou", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "first" };
	const d = decidePhase({ ...base, reason: "retry", state });
	assert.equal(d.phase, "first");
});

test("retry depois de compactação por overflow vai para D", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "work" };
	const d = decidePhase({ ...base, reason: "retry", state, hasPrevious: true, latestCompactionId: "c1" });
	assert.equal(d.phase, "afterCompaction");
});

test("retry de D com compactação prevista mantém D", () => {
	const state: RouterState = { seenCompactionId: null, lastPhase: "afterCompaction", pendingCompaction: true };
	const d = decidePhase({ ...base, reason: "retry", state, hasPrevious: true, latestCompactionId: "c1" });
	assert.equal(d.phase, "afterCompaction");
	assert.deepEqual(d.state, { seenCompactionId: "c1", lastPhase: "afterCompaction" });
});
