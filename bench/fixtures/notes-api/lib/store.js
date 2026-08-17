'use strict';
// In-memory notes store.

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function createStore() {
  const notes = new Map();
  let nextId = 1;

  return {
    add({ title, body = '' }) {
      if (!isNonEmptyString(title)) {
        throw new Error('title must be a non-empty string');
      }
      const note = { id: nextId++, title: title.trim(), body, createdAt: new Date() };
      notes.set(note.id, note);
      return note;
    },
    get(id) {
      return notes.get(id) || null;
    },
    list() {
      return [...notes.values()];
    },
  };
}

module.exports = { createStore, isNonEmptyString };
