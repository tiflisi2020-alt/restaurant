const $ = (selector) => document.querySelector(selector);
const dateInput = $('#admin-date');
const timezone = 'Asia/Tbilisi';
function todayInTbilisi() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
async function api(path, options = {}) { const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options }); const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch { body = { error: 'სერვერის პასუხი ვერ დამუშავდა.' }; } if (!response.ok) throw new Error(body.error || 'მოთხოვნა ვერ შესრულდა.'); return body; }
function showDashboard() { $('#login-view').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); loadReservations(); }
async function checkSession() { try { const state = await api('/api/admin/session'); if (state.authenticated) showDashboard(); } catch (error) { $('#login-error').textContent = error.message; } }
$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; $('#login-error').textContent = ''; try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); showDashboard(); } catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; } });
$('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST' }); } finally { location.reload(); } });
$('#load').addEventListener('click', loadReservations); dateInput.addEventListener('change', loadReservations); dateInput.value = todayInTbilisi();
async function loadReservations() {
  const rows = $('#rows'); rows.innerHTML = '<tr><td colspan="7">იტვირთება...</td></tr>'; $('#summary').textContent = '';
  try {
    const data = await api(`/api/admin/reservations?date=${encodeURIComponent(dateInput.value)}`); $('#summary').textContent = `${data.length} რეზერვაცია`;
    rows.innerHTML = data.length ? data.map((row) => `<tr><td>${String(row.reservation_time || '').slice(0, 5)}</td><td><strong>${escapeHtml(row.guest_name)}</strong><br><span class="muted">${escapeHtml(row.confirmation_code)}</span></td><td>${escapeHtml(row.phone)}</td><td>${row.guests}</td><td>${escapeHtml(row.restaurant_tables?.name || '—')}</td><td><span class="status status-${escapeHtml(row.status)}">${label(row.status)}</span></td><td>${actionButton(row)}</td></tr>`).join('') : '<tr><td colspan="7">ამ დღისთვის რეზერვაციები არ არის.</td></tr>';
  } catch (error) { rows.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`; }
}
function actionButton(row) { if (row.status === 'cancelled' || row.status === 'completed' || row.status === 'no_show') return '—'; const next = row.status === 'pending' ? 'confirmed' : row.status === 'confirmed' ? 'seated' : 'completed'; const text = { confirmed: 'დადასტურება', seated: 'დასმა', completed: 'დასრულება' }[next]; return `<button class="small-button" data-id="${escapeHtml(row.id)}" data-status="${next}">${text}</button>`; }
$('#rows').addEventListener('click', async (event) => { const button = event.target.closest('button[data-id]'); if (!button) return; button.disabled = true; try { await api(`/api/admin/reservations/${encodeURIComponent(button.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.status }) }); await loadReservations(); } catch (error) { $('#summary').textContent = error.message; button.disabled = false; } });
function label(status) { return ({ pending: 'მოლოდინში', confirmed: 'დადასტურებული', seated: 'მაგიდასთან', completed: 'დასრულებული', cancelled: 'გაუქმებული', no_show: 'არ გამოცხადდა' })[status] || status; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }
checkSession();
