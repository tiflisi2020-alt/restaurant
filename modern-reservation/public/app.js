const $ = (selector) => document.querySelector(selector);
const dateInput = $('#date');
const slotInput = $('#slot');
const submitButton = $('#reservation-form button[type="submit"]');
const message = $('#form-message');
const timezone = 'Asia/Tbilisi';

function todayInTbilisi() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const text = await response.text(); let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: 'სერვერის პასუხი ვერ დამუშავდა.' }; }
  if (!response.ok) throw new Error(body.error || 'მოთხოვნა ვერ შესრულდა.');
  return body;
}
function setMessage(text, type = '') { message.textContent = text; message.dataset.type = type; }
function setSlotUnavailable(text) { slotInput.innerHTML = `<option value="">${text}</option>`; slotInput.disabled = true; $('#table-id').value = ''; submitButton.disabled = true; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }

async function loadMenu() {
  try {
    const items = await api('/api/menu');
    $('#menu-list').innerHTML = items.length ? items.map((item) => `<article class="menu-item"><h3>${escapeHtml(item.name)}</h3><b>${Number(item.price).toFixed(0)} ₾</b><p>${escapeHtml(item.description || item.menu_categories?.name || '')}</p></article>`).join('') : '<p class="muted">მენიუ მალე დაემატება.</p>';
  } catch { $('#menu-list').innerHTML = '<p class="muted">მენიუ დროებით მიუწვდომელია.</p>'; }
}
async function loadAvailability() {
  setSlotUnavailable('თავისუფალ დროს ვამოწმებთ...'); setMessage('');
  try {
    const data = await api(`/api/availability?date=${encodeURIComponent(dateInput.value)}&guests=${encodeURIComponent($('#guests').value)}`);
    if (!data.slots.length) { setSlotUnavailable('ამ თარიღზე თავისუფალი მაგიდა აღარ არის'); setMessage('გთხოვთ აირჩიოთ სხვა თარიღი ან სტუმრების რაოდენობა.', 'info'); return; }
    slotInput.innerHTML = data.slots.map((item) => `<option value="${item.time}|${item.tables[0].id}">${item.time} · ${escapeHtml(item.tables[0].name)} (${item.tables[0].seats} ადგილი)</option>`).join('');
    slotInput.disabled = false; submitButton.disabled = false; const [, tableId] = slotInput.value.split('|'); $('#table-id').value = tableId || '';
  } catch (error) { setSlotUnavailable('ხელმისაწვდომობა დროებით მიუწვდომელია'); setMessage(error.message, 'error'); }
}

dateInput.min = todayInTbilisi(); dateInput.value = dateInput.min;
dateInput.addEventListener('change', loadAvailability); $('#guests').addEventListener('change', loadAvailability);
slotInput.addEventListener('change', () => { const [, tableId] = slotInput.value.split('|'); $('#table-id').value = tableId || ''; });
loadAvailability(); loadMenu();

$('#reservation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!slotInput.value || !$('#table-id').value) { setMessage('გთხოვთ აირჩიოთ ხელმისაწვდომი დრო.', 'error'); return; }
  const [time] = slotInput.value.split('|'); submitButton.disabled = true; setMessage('ვადასტურებთ თქვენს მაგიდას...');
  try {
    const reservation = await api('/api/reservations', { method: 'POST', body: JSON.stringify({ reservation_date: dateInput.value, reservation_time: time, guests: $('#guests').value, table_id: $('#table-id').value, guest_name: $('#name').value, phone: $('#phone').value, email: $('#email').value, notes: $('#notes').value }) });
    $('#confirmation-code').textContent = reservation.confirmation_code; $('#success-modal').hidden = false; event.target.reset(); dateInput.min = todayInTbilisi(); dateInput.value = dateInput.min; setMessage(''); await loadAvailability();
  } catch (error) { setMessage(error.message, 'error'); submitButton.disabled = false; }
});
$('.modal-close').addEventListener('click', () => { $('#success-modal').hidden = true; });
$('#success-modal').addEventListener('click', (event) => { if (event.target.id === 'success-modal') $('#success-modal').hidden = true; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('#success-modal').hidden = true; });
