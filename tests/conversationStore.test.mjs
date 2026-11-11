// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import storeModule from "../conversationStore.cjs";

const { createConversationStore } = storeModule;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pulplog-conversations-"));
  t.after(() => rmSync(dir, { recursive:true, force:true }));
  return { store:createConversationStore({ filename:join(dir, "conversations.json") }), dir };
}

test("persists, lists and restores a conversation", async t => {
  const { store } = fixture(t);
  const saved = await store.save({
    id:"chat-1", title:"API failure", sourceLabel:"payments.log", provider:"ollama", model:"qwen",
    messages:[{ id:"u1", role:"user", content:"What failed?" }, { id:"a1", role:"assistant", content:"The pool was exhausted." }],
    memory:{ objective:"Find the root cause" },
  });
  assert.equal(saved.id, "chat-1");
  assert.equal((await store.list())[0].messageCount, 2);
  assert.equal((await store.get("chat-1")).memory.objective, "Find the root cause");
});

test("deleting a conversation removes its messages and memory", async t => {
  const { store, dir } = fixture(t);
  await store.save({ id:"chat-1", messages:[{ role:"user", content:"secret log" }], memory:{ summary:"secret summary" } });
  assert.equal(await store.remove("chat-1"), true);
  assert.equal(await store.get("chat-1"), null);
  assert.doesNotMatch(readFileSync(join(dir, "conversations.json"), "utf8"), /secret/);
});

test("clear removes every persisted conversation", async t => {
  const { store } = fixture(t);
  await store.save({ id:"one", messages:[{ role:"user", content:"one" }] });
  await store.save({ id:"two", messages:[{ role:"user", content:"two" }] });
  await store.clear();
  assert.deepEqual(await store.list(), []);
});

test("serializes concurrent saves without losing either conversation", async t => {
  const { store } = fixture(t);
  await Promise.all([
    store.save({ id:"one", messages:[{ role:"user", content:"one" }] }),
    store.save({ id:"two", messages:[{ role:"user", content:"two" }] }),
  ]);
  assert.deepEqual((await store.list()).map(item => item.id).sort(), ["one", "two"]);
});
