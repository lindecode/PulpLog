// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_VERSION = 1;
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES = 200;
const MAX_CONTENT = 50000;
const MAX_CONVERSATION_CHARS = 2_000_000;

const cleanText = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

function normalizeMessage(message) {
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  const content = cleanText(message.content, MAX_CONTENT);
  if (!content && !message.stopped && !message.error) return null;
  const meta = message.meta && typeof message.meta === "object"
    ? Object.fromEntries(Object.entries(message.meta).filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean").slice(0, 20))
    : null;
  return {
    id: cleanText(message.id, 100) || crypto.randomUUID(),
    role: message.role,
    content,
    ...(cleanText(message.label, 500) ? { label:cleanText(message.label, 500) } : {}),
    ...(cleanText(message.error, 2000) ? { error:cleanText(message.error, 2000) } : {}),
    ...(message.stopped === true ? { stopped:true } : {}),
    ...(meta ? { meta } : {}),
  };
}

function normalizeConversation(value) {
  if (!value || typeof value !== "object") return null;
  const now = new Date().toISOString();
  const messages = [];
  let messageChars = 0;
  const inputMessages = Array.isArray(value.messages) ? value.messages : [];
  for (let index = inputMessages.length - 1; index >= 0 && messages.length < MAX_MESSAGES; index--) {
    const message = normalizeMessage(inputMessages[index]);
    if (!message) continue;
    if (messages.length && messageChars + message.content.length > MAX_CONVERSATION_CHARS) break;
    messages.unshift(message);
    messageChars += message.content.length;
  }
  const rawMemory = value.memory && typeof value.memory === "object" ? value.memory : {};
  return {
    id: cleanText(value.id, 100) || crypto.randomUUID(),
    title: cleanText(value.title, 120) || "Nueva conversación",
    sourceLabel:cleanText(value.sourceLabel, 500),
    provider:cleanText(value.provider, 20),
    model:cleanText(value.model, 200),
    createdAt:cleanText(value.createdAt, 40) || now,
    updatedAt:cleanText(value.updatedAt, 40) || now,
    messages,
    memory: {
      objective:cleanText(rawMemory.objective, 2000),
      summary:cleanText(rawMemory.summary, 10000),
    },
  };
}

function createConversationStore({ filename }) {
  let queue = Promise.resolve();

  async function read() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(filename, "utf8"));
      const conversations = (Array.isArray(parsed?.conversations) ? parsed.conversations : [])
        .map(normalizeConversation).filter(Boolean).slice(0, MAX_CONVERSATIONS);
      return { version:STORE_VERSION, conversations };
    } catch (error) {
      if (error.code === "ENOENT") return { version:STORE_VERSION, conversations:[] };
      throw error;
    }
  }

  async function writeFile(data) {
    await fs.promises.mkdir(path.dirname(filename), { recursive:true });
    const temporary = `${filename}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2), { encoding:"utf8", mode:0o600 });
    await fs.promises.rename(temporary, filename);
  }

  function update(mutator) {
    const operation = queue.then(async () => {
      const data = await read();
      const result = await mutator(data);
      await writeFile(data);
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  async function list() {
    await queue;
    const { conversations } = await read();
    return conversations
      .map(({ messages, memory, ...conversation }) => ({ ...conversation, messageCount:messages.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function get(id) {
    await queue;
    const { conversations } = await read();
    return conversations.find(item => item.id === id) || null;
  }

  async function save(input) {
    return update(data => {
      const conversation = normalizeConversation({ ...input, updatedAt:new Date().toISOString() });
      const index = data.conversations.findIndex(item => item.id === conversation.id);
      if (index >= 0) {
        conversation.createdAt = data.conversations[index].createdAt;
        data.conversations[index] = conversation;
      } else {
        data.conversations.unshift(conversation);
      }
      data.conversations = data.conversations.slice(0, MAX_CONVERSATIONS);
      return conversation;
    });
  }

  async function remove(id) {
    return update(data => {
      const before = data.conversations.length;
      data.conversations = data.conversations.filter(item => item.id !== id);
      return data.conversations.length !== before;
    });
  }

  async function clear() {
    return update(data => {
      data.version = STORE_VERSION;
      data.conversations = [];
      return true;
    });
  }

  return { list, get, save, remove, clear };
}

module.exports = { createConversationStore, normalizeConversation };
