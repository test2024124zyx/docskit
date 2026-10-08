"use strict";

// 字节预算限制缓存内容规模，条目上限同时约束大量极小结果。
class ByteBudgetCache {
  constructor(maxBytes, maxEntries = Infinity) {
    this.entries = new Map();
    this.bytes = 0;
    this.maxEntries = maxEntries;
    this.setBudget(maxBytes);
  }

  get size() { return this.entries.size; }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, bytes = Buffer.byteLength(JSON.stringify(value))) {
    this.delete(key);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) return this;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    this.evict();
    return this;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    return this.entries.delete(key);
  }

  setBudget(maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("缓存字节预算必须为正整数");
    this.maxBytes = maxBytes;
    this.evict();
  }

  evict() {
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      this.delete(this.entries.keys().next().value);
    }
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

module.exports = { ByteBudgetCache };
