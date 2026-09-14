require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ============================================================
// CURRENCY MAP
// ============================================================
const CURRENCY_MAP = {
  'Nigeria': { code: 'NGN', symbol: '₦' },
  'USA': { code: 'USD', symbol: '$' },
  'United States': { code: 'USD', symbol: '$' },
  'Canada': { code: 'CAD', symbol: 'C$' },
  'UK': { code: 'GBP', symbol: '£' },
  'United Kingdom': { code: 'GBP', symbol: '£' },
  'Ghana': { code: 'GHS', symbol: '₵' },
  'Kenya': { code: 'KES', symbol: 'KSh' },
  'South Africa': { code: 'ZAR', symbol: 'R' },
  'India': { code: 'INR', symbol: '₹' },
  'Germany': { code: 'EUR', symbol: '€' },
  'France': { code: 'EUR', symbol: '€' },
  'Italy': { code: 'EUR', symbol: '€' },
  'Spain': { code: 'EUR', symbol: '€' },
  'Netherlands': { code: 'EUR', symbol: '€' },
  'Australia': { code: 'AUD', symbol: 'A$' },
  'Brazil': { code: 'BRL', symbol: 'R$' },
  'Japan': { code: 'JPY', symbol: '¥' },
  'China': { code: 'CNY', symbol: '¥' },
  'UAE': { code: 'AED', symbol: 'د.إ' },
  'Egypt': { code: 'EGP', symbol: 'E£' },
  'Pakistan': { code: 'PKR', symbol: '₨' },
  'Bangladesh': { code: 'BDT', symbol: '৳' },
  'Philippines': { code: 'PHP', symbol: '₱' },
  'Indonesia': { code: 'IDR', symbol: 'Rp' },
  'Malaysia': { code: 'MYR', symbol: 'RM' },
  'Singapore': { code: 'SGD', symbol: 'S$' },
};

function getCurrency(country) {
  if (!country) return { code: 'USD', symbol: '$' };
  const direct = CURRENCY_MAP[country];
  if (direct) return direct;
  const key = Object.keys(CURRENCY_MAP).find(k => k.toLowerCase() === country.toLowerCase());
  return key ? CURRENCY_MAP[key] : { code: 'USD', symbol: '$' };
}

// ============================================================
// HELPERS
// ============================================================
async function getAdmin(email) {
  if (!email) return null;
  const { data } = await supabase.from('users').select('role').eq('email', email).single();
  if (data && data.role === 'admin') return email;
  return null;
}

// ============================================================
// SIGNUP
// ============================================================
app.post('/signup', async (req, res) => {
  try {
    const { email, password, name, phone, country, address, bank_name, account_number, account_holder } = req.body;

    const missing = [];
    if (!email) missing.push('email');
    if (!password) missing.push('password');
    if (!name) missing.push('name');
    if (!country) missing.push('country');
    if (!address) missing.push('address');
    if (missing.length > 0) {
      return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
    }

    const { data: existing } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Email already registered. Please log in.' });

    const currency = getCurrency(country);

    const newUser = {
      email, password, name,
      phone: phone || '',
      country, address,
      bank_name: bank_name || '',
      account_number: account_number || '',
      account_holder: account_holder || name,
      currency_code: currency.code,
      currency_symbol: currency.symbol,
      balance: 0,
      frozen: false,
      role: 'user',
      theme: 'dark',
    };

    const { error } = await supabase.from('users').insert([newUser]);
    if (error) {
      console.error('❌ Signup DB error:', error);
      return res.status(500).json({
        error: 'Database error: ' + (error.message || 'Unknown'),
        code: error.code || null,
      });
    }

    return res.json({ success: true, email, name, currency });
  } catch (err) {
    console.error('❌ Signup exception:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ============================================================
// LOGIN
// ============================================================
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    if (!data || data.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
    if (data.frozen) return res.status(403).json({ error: 'Your account has been frozen. Contact support.' });

    return res.json({
      success: true,
      email: data.email,
      name: data.name,
      phone: data.phone,
      country: data.country,
      address: data.address,
      bank_name: data.bank_name,
      account_number: data.account_number,
      account_holder: data.account_holder,
      balance: data.balance || 0,
      currency_code: data.currency_code || 'USD',
      currency_symbol: data.currency_symbol || '$',
      theme: data.theme || 'dark',
      role: data.role || 'user',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ============================================================
// GET USER
// ============================================================
app.get('/user/:email', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').eq('email', req.params.email).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json({
    email: data.email, name: data.name, phone: data.phone,
    country: data.country, address: data.address,
    bank_name: data.bank_name, account_number: data.account_number, account_holder: data.account_holder,
    balance: data.balance || 0,
    currency_code: data.currency_code || 'USD',
    currency_symbol: data.currency_symbol || '$',
    theme: data.theme || 'dark',
  });
});

// ============================================================
// THEME
// ============================================================
app.post('/user/theme', async (req, res) => {
  const { email, theme } = req.body;
  if (!email || !['dark', 'light'].includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
  await supabase.from('users').update({ theme }).eq('email', email);
  res.json({ success: true });
});

// ============================================================
// DEPOSIT REQUEST
// ============================================================
app.post('/request-deposit', async (req, res) => {
  const { email, amount } = req.body;
  if (!email || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const { error } = await supabase.from('deposits').insert([{ user_email: email, amount, status: 'pending' }]);
  if (error) return res.status(500).json({ error: 'Deposit request failed: ' + error.message });
  res.json({ success: true, message: 'Deposit request sent. You will receive instructions shortly.' });
});

// ============================================================
// MESSAGES
// ============================================================
app.post('/send-message', async (req, res) => {
  const { adminEmail, recipients, title, content, senderName, allowReply } = req.body;
  if (!(await getAdmin(adminEmail))) return res.status(403).json({ error: 'Admin only' });
  if (!content || !senderName) return res.status(400).json({ error: 'Message content and sender required' });

  let targetEmails = [];
  if (recipients === 'all') {
    const { data: users } = await supabase.from('users').select('email').neq('role', 'admin');
    targetEmails = (users || []).map(u => u.email);
  } else if (Array.isArray(recipients)) targetEmails = recipients;
  else if (typeof recipients === 'string') targetEmails = [recipients];

  if (targetEmails.length === 0) return res.status(400).json({ error: 'No recipients selected' });

  const rows = targetEmails.map(to => ({
    from_email: adminEmail, to_email: to,
    title: title || 'Message from MRC',
    content,
    sender_display_name: senderName,
    allow_reply: allowReply || false,
    read_status: false,
    parent_id: null,
  }));

  const { error } = await supabase.from('messages').insert(rows);
  if (error) return res.status(500).json({ error: 'Failed to send message: ' + error.message });

  await supabase.from('audit_logs').insert([{
    admin_email: adminEmail, action: 'send_message',
    target_email: recipients === 'all' ? 'ALL' : targetEmails.join(','),
    details: { title, content, senderName, allowReply, count: targetEmails.length }
  }]);

  res.json({ success: true, sent: targetEmails.length });
});

app.get('/messages/:email', async (req, res) => {
  const email = req.params.email;
  const { data, error } = await supabase.from('messages').select('*')
    .or(`to_email.eq.${email},from_email.eq.${email}`)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to fetch messages' });
  res.json(data || []);
});

app.post('/messages/mark-read', async (req, res) => {
  const { email, messageId } = req.body;
  if (!email || !messageId) return res.status(400).json({ error: 'Missing fields' });
  await supabase.from('messages').update({ read_status: true }).eq('id', messageId).eq('to_email', email);
  res.json({ success: true });
});

app.post('/reply-message', async (req, res) => {
  const { fromEmail, parentId, content } = req.body;
  if (!fromEmail || !parentId || !content) return res.status(400).json({ error: 'Missing fields' });

  const { data: parent } = await supabase.from('messages').select('from_email, title').eq('id', parentId).maybeSingle();
  if (!parent) return res.status(404).json({ error: 'Parent message not found' });

  const { error } = await supabase.from('messages').insert([{
    from_email: fromEmail, to_email: parent.from_email,
    title: 'Re: ' + (parent.title || 'Message'),
    content,
    sender_display_name: null, allow_reply: false, read_status: false, parent_id: parentId,
  }]);
  if (error) return res.status(500).json({ error: 'Failed to send reply' });
  res.json({ success: true });
});

// ============================================================
// MODES — PUBLIC + USER
// ============================================================
app.get('/modes', async (req, res) => {
  const { data, error } = await supabase.from('modes').select('*').eq('is_active', true).order('access_amount', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/user-mode/:email', async (req, res) => {
  const { data, error } = await supabase.from('user_modes').select('*, modes(*)')
    .eq('user_email', req.params.email).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

app.post('/activate-mode', async (req, res) => {
  const { email, modeId } = req.body;
  if (!email || !modeId) return res.status(400).json({ error: 'Missing email or modeId' });

  const { data: mode } = await supabase.from('modes').select('*').eq('id', modeId).maybeSingle();
  if (!mode) return res.status(404).json({ error: 'Mode not found' });
  if (!mode.is_active) return res.status(400).json({ error: 'This mode is not available' });

  const { data: existing } = await supabase.from('user_modes').select('id, status')
    .eq('user_email', email).eq('mode_id', modeId)
    .in('status', ['PENDING', 'PROCESSING', 'COMPLETED']).maybeSingle();
  if (existing) {
    return res.status(400).json({ error: 'You already have an active or processing request for this mode', status: existing.status });
  }

  const reference = 'MRC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();

  const { data: userMode, error: umErr } = await supabase.from('user_modes')
    .insert([{ user_email: email, mode_id: modeId, status: 'PENDING' }]).select().single();
  if (umErr) return res.status(500).json({ error: umErr.message });

  const { error: txErr } = await supabase.from('transactions').insert([{
    user_email: email, type: 'mode_activation', amount: mode.access_amount,
    currency_code: mode.currency_code, currency_symbol: mode.currency_symbol,
    status: 'PROCESSING', reference,
    metadata: { mode_id: modeId, mode_name: mode.name, user_mode_id: userMode.id }
  }]);
  if (txErr) return res.status(500).json({ error: txErr.message });

  await supabase.from('user_modes').update({ status: 'PROCESSING' }).eq('id', userMode.id);

  return res.json({
    success: true, reference, status: 'PROCESSING',
    message: 'Your payment is being processed. It may take up to 8 hours to reflect due to payment and verification processing.'
  });
});

app.get('/transaction/:reference', async (req, res) => {
  const { data, error } = await supabase.from('transactions').select('*').eq('reference', req.params.reference).maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Transaction not found' });
  res.json(data);
});

app.get('/transactions/:email', async (req, res) => {
  const { data, error } = await supabase.from('transactions').select('*')
    .eq('user_email', req.params.email).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/complete-task', async (req, res) => {
  const { email, modeId, tasks } = req.body;
  if (!email || !modeId || !tasks) return res.status(400).json({ error: 'Missing fields' });

  const { data: um } = await supabase.from('user_modes').select('*')
    .eq('user_email', email).eq('mode_id', modeId).eq('status', 'COMPLETED').maybeSingle();
  if (!um) return res.status(403).json({ error: 'You do not have an active mode' });

  if (um.expires_at && new Date(um.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Your mode has expired' });
  }

  const { data: mode } = await supabase.from('modes').select('*').eq('id', modeId).maybeSingle();
  if (!mode) return res.status(404).json({ error: 'Mode not found' });

  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabase.from('task_completions').select('*')
    .eq('user_email', email).eq('mode_id', modeId).eq('task_date', today).maybeSingle();

  const already = existing ? existing.tasks_completed : 0;
  const remaining = Math.max(0, mode.tasks_per_day - already);

  if (tasks > remaining) return res.status(400).json({ error: `You can only complete ${remaining} more tasks today.`, remaining });

  const earnings = tasks * mode.reward_per_task;

  if (existing) {
    await supabase.from('task_completions').update({
      tasks_completed: already + tasks,
      earnings: (existing.earnings || 0) + earnings
    }).eq('id', existing.id);
  } else {
    await supabase.from('task_completions').insert([{
      user_email: email, mode_id: modeId, task_date: today, tasks_completed: tasks, earnings
    }]);
  }

  const { data: user } = await supabase.from('users').select('balance').eq('email', email).maybeSingle();
  const newBalance = (user?.balance || 0) + earnings;
  await supabase.from('users').update({ balance: newBalance }).eq('email', email);

  await supabase.from('transactions').insert([{
    user_email: email, type: 'task_earning', amount: earnings,
    currency_code: mode.currency_code, currency_symbol: mode.currency_symbol,
    status: 'COMPLETED', metadata: { mode_id: modeId, tasks }
  }]);

  return res.json({ success: true, earnings, newBalance, remaining: remaining - tasks });
});

app.get('/task-progress/:email/:modeId', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('task_completions').select('*')
    .eq('user_email', req.params.email).eq('mode_id', req.params.modeId).eq('task_date', today).maybeSingle();
  res.json(data || { tasks_completed: 0, earnings: 0 });
});

// ============================================================
// ADMIN
// ============================================================
app.post('/admin/users', async (req, res) => {
  const { adminEmail, action, targetEmail, data } = req.body;
  if (!(await getAdmin(adminEmail))) return res.status(403).json({ error: 'Admin only — unauthorized' });

  if (action === 'list') {
    const { data: users, error } = await supabase.from('users').select('*').neq('role', 'admin').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch users' });
    return res.json(users || []);
  }

  if (action === 'get') {
    const { data: user } = await supabase.from('users').select('*').eq('email', targetEmail).maybeSingle();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { data: msgs } = await supabase.from('messages').select('*').or(`to_email.eq.${targetEmail},from_email.eq.${targetEmail}`).order('created_at', { ascending: false });
    const { data: logs } = await supabase.from('balance_logs').select('*').eq('user_email', targetEmail).order('created_at', { ascending: false });
    return res.json({ user, messages: msgs || [], balanceLogs: logs || [] });
  }

  if (action === 'editBalance') {
    const amount = parseFloat(data.amount) || 0;
    if (amount === 0) return res.status(400).json({ error: 'Amount must be non-zero' });
    const { data: user } = await supabase.from('users').select('balance').eq('email', targetEmail).maybeSingle();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const oldBalance = user.balance || 0;
    const newBalance = oldBalance + amount;
    const { error: upErr } = await supabase.from('users').update({ balance: newBalance }).eq('email', targetEmail);
    if (upErr) return res.status(500).json({ error: 'Balance update failed: ' + upErr.message });
    await supabase.from('balance_logs').insert([{ user_email: targetEmail, admin_email: adminEmail, old_balance: oldBalance, new_balance: newBalance, amount, note: data.note || '' }]);
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'edit_balance', target_email: targetEmail, details: { oldBalance, newBalance, amount } }]);
    return res.json({ success: true, newBalance });
  }

  if (action === 'freeze' || action === 'unfreeze') {
    const frozen = action === 'freeze';
    const { error } = await supabase.from('users').update({ frozen }).eq('email', targetEmail);
    if (error) return res.status(500).json({ error: 'Update failed' });
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: frozen ? 'freeze_user' : 'unfreeze_user', target_email: targetEmail, details: {} }]);
    return res.json({ success: true });
  }

  if (action === 'pendingDeposits') {
    const { data } = await supabase.from('deposits').select('*').eq('status', 'pending').order('created_at', { ascending: true });
    return res.json(data || []);
  }

  if (action === 'completeDeposit') {
    const { depositId } = data;
    if (!depositId) return res.status(400).json({ error: 'Deposit ID required' });
    const { data: dep } = await supabase.from('deposits').select('user_email, amount').eq('id', depositId).maybeSingle();
    if (!dep) return res.status(404).json({ error: 'Deposit not found' });
    await supabase.from('deposits').update({ status: 'completed' }).eq('id', depositId);
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'complete_deposit', target_email: dep.user_email, details: { amount: dep.amount } }]);
    return res.json({ success: true });
  }

  if (action === 'getMessages') {
    const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false });
    return res.json(data || []);
  }

  if (action === 'getAuditLogs') {
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
    return res.json(data || []);
  }

  if (action === 'getBalanceLogs') {
    const { data } = await supabase.from('balance_logs').select('*').order('created_at', { ascending: false }).limit(200);
    return res.json(data || []);
  }

  // MODES ADMIN
  if (action === 'createMode') {
    const { name, description, access_amount, currency_code, currency_symbol, tasks_per_day, reward_per_task, duration_months } = data;
    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + parseInt(duration_months || 12));
    const { error } = await supabase.from('modes').insert([{
      name, description, access_amount, currency_code, currency_symbol,
      tasks_per_day, reward_per_task, duration_months,
      start_date: start.toISOString(), end_date: end.toISOString()
    }]);
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'create_mode', target_email: null, details: { name } }]);
    return res.json({ success: true });
  }

  if (action === 'listModes') {
    const { data: modes } = await supabase.from('modes').select('*').order('created_at', { ascending: false });
    return res.json(modes || []);
  }

  if (action === 'deleteMode') {
    await supabase.from('modes').delete().eq('id', data.modeId);
    return res.json({ success: true });
  }

  if (action === 'pendingModes') {
    const { data: pending } = await supabase.from('user_modes').select('*, modes(*)').in('status', ['PENDING', 'PROCESSING']).order('created_at', { ascending: true });
    return res.json(pending || []);
  }

  if (action === 'approveMode') {
    const { data: um } = await supabase.from('user_modes').select('*, modes(*)').eq('id', data.userModeId).maybeSingle();
    if (!um) return res.status(404).json({ error: 'Not found' });
    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + (um.modes.duration_months || 12));
    await supabase.from('user_modes').update({ status: 'COMPLETED', activated_at: start.toISOString(), expires_at: end.toISOString() }).eq('id', data.userModeId);
    const { data: lastTx } = await supabase.from('transactions').select('reference').eq('user_email', um.user_email).eq('type', 'mode_activation').eq('status', 'PROCESSING').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lastTx) await supabase.from('transactions').update({ status: 'COMPLETED' }).eq('reference', lastTx.reference);
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'approve_mode', target_email: um.user_email, details: { mode: um.modes.name } }]);
    return res.json({ success: true });
  }

  if (action === 'rejectMode') {
    const { data: um } = await supabase.from('user_modes').select('*').eq('id', data.userModeId).maybeSingle();
    if (!um) return res.status(404).json({ error: 'Not found' });
    await supabase.from('user_modes').update({ status: 'FAILED' }).eq('id', data.userModeId);
    await supabase.from('transactions').update({ status: 'FAILED' }).eq('user_email', um.user_email).eq('type', 'mode_activation').eq('status', 'PROCESSING');
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'reject_mode', target_email: um.user_email, details: {} }]);
    return res.json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 MRC server running at http://localhost:${PORT}`);
  console.log('📧 Admin login: admin@mrc.com / admin123');
});
