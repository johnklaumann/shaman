'use strict';
// Presentation helpers for API responses.

// Formats a Date as DD/MM/YYYY.
function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toPublicNote(note) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    createdAt: formatDate(note.createdAt),
  };
}

module.exports = { formatDate, toPublicNote };
