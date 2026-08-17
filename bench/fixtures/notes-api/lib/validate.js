'use strict';
// Request validation helpers.

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateNotePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('payload must be an object');
    return errors;
  }
  if (!isNonEmptyString(payload.title)) {
    errors.push('title must be a non-empty string');
  }
  if (payload.body !== undefined && typeof payload.body !== 'string') {
    errors.push('body must be a string');
  }
  return errors;
}

module.exports = { validateNotePayload, isNonEmptyString };
