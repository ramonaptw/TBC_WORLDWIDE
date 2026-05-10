function initials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return '–';
  return new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '–';
  return new Date(dateStr).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function badge(value, type) {
  const labels = {
    new: 'Neu', contacted: 'Kontaktiert', qualified: 'Qualifiziert', lost: 'Verloren',
    open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt',
    high: 'Hoch', medium: 'Mittel', low: 'Niedrig',
    admin: 'Admin', manager: 'Manager', employee: 'Mitarbeiter'
  };
  return `<span class="badge badge-${value}">${labels[value] || value}</span>`;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `alert alert-${type}`;
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;min-width:250px;box-shadow:0 4px 20px rgba(0,0,0,0.15)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function confirmDelete(msg) { return confirm(msg || 'Wirklich löschen?'); }

window.initials = initials;
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.badge = badge;
window.showToast = showToast;
window.openModal = openModal;
window.closeModal = closeModal;
window.confirmDelete = confirmDelete;
