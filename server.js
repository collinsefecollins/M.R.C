require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const CURRENCY_MAP = {
  'Nigeria': { code: 'NGN', symbol: '₦' },
  'USA': { code: 'USD', symbol: '$' }, 'United States': { code: 'USD', symbol: '$' },
  'Canada': { code: 'CAD', symbol: 'C$' },
  'UK': { code: 'GBP', symbol: '£' }, 'United Kingdom': { code: 'GBP', symbol: '£' },
  'Australia': { code: 'AUD', symbol: 'A$' }, 'Brazil': { code: 'BRL', symbol: 'R$' },
  'Germany': { code: 'EUR', symbol: '€' }, 'Portugal': { code: 'EUR', symbol: '€' }, 'Euro area': { code: 'EUR', symbol: '€' },
  'UAE': { code: 'AED', symbol: 'د.إ' }, 'South Africa': { code: 'ZAR', symbol: 'R' },
  'India': { code: 'INR', symbol: '₹' }, 'Singapore': { code: 'SGD', symbol: 'S$' },
  'Ghana': { code: 'GHS', symbol: '₵' }, 'Kenya': { code: 'KES', symbol: 'KSh' },
};
function getCurrency(c) {
  if (!c) return { code: 'USD', symbol: '$' };
  const d = CURRENCY_MAP[c]; if (d) return d;
  const k = Object.keys(CURRENCY_MAP).find(x => x.toLowerCase() === c.toLowerCase());
  return k ? CURRENCY_MAP[k] : { code: 'USD', symbol: '$' };
}

async function getAdmin(email) {
  if (!email) return null;
  const { data } = await supabase.from('users').select('role').eq('email', email).single();
  return data && data.role === 'admin' ? email : null;
}

/* SIGNUP */
app.post('/signup', async (req, res) => {
  try {
    const { email, password, name, phone, country, address, bank_name, account_number, account_holder } = req.body;
    const miss = [];
    if (!email) miss.push('email'); if (!password) miss.push('password');
    if (!name) miss.push('name'); if (!country) miss.push('country'); if (!address) miss.push('address');
    if (miss.length) return res.status(400).json({ error: 'Missing: ' + miss.join(', ') });

    const { data: ex } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
    if (ex) return res.status(400).json({ error: 'Email already registered.' });

    const cur = getCurrency(country);
    const { error } = await supabase.from('users').insert([{
      email, password, name, phone: phone || '', country, address,
      bank_name: bank_name || '', account_number: account_number || '',
      account_holder: account_holder || name,
      currency_code: cur.code, currency_symbol: cur.symbol,
      balance: 0, frozen: false, role: 'user', theme: 'dark'
    }]);
    if (error) return res.status(500).json({ error: 'DB error: ' + error.message });
    res.json({ success: true, email, name, currency: cur });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* LOGIN */
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email & password required' });
  const { data } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  if (!data || data.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
  if (data.frozen) return res.status(403).json({ error: 'Account frozen. Contact support.' });
  res.json({
    success: true, email: data.email, name: data.name, phone: data.phone,
    country: data.country, address: data.address,
    bank_name: data.bank_name, account_number: data.account_number, account_holder: data.account_holder,
    balance: data.balance || 0,
    currency_code: data.currency_code || 'USD', currency_symbol: data.currency_symbol || '$',
    theme: data.theme || 'dark', role: data.role || 'user'
  });
});

/* GET USER */
app.get('/user/:email', async (req, res) => {
  const { data } = await supabase.from('users').select('*').eq('email', req.params.email).maybeSingle();
  if (!data) return res.status(404).json({ error: 'User not found' });
  res.json({
    email: data.email, name: data.name, phone: data.phone, country: data.country, address: data.address,
    bank_name: data.bank_name, account_number: data.account_number, account_holder: data.account_holder,
    balance: data.balance || 0,
    currency_code: data.currency_code || 'USD', currency_symbol: data.currency_symbol || '$',
    theme: data.theme || 'dark'
  });
});

/* THEME */
app.post('/user/theme', async (req, res) => {
  const { email, theme } = req.body;
  if (!email || !['dark', 'light'].includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
  await supabase.from('users').update({ theme }).eq('email', email);
  res.json({ success: true });
});

/* DEPOSIT */
app.post('/request-deposit', async (req, res) => {
  const { email, amount } = req.body;
  if (!email || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const { error } = await supabase.from('deposits').insert([{ user_email: email, amount, status: 'pending' }]);
  if (error) return res.status(500).json({ error: 'Deposit failed' });
  res.json({ success: true, message: 'Deposit request sent.' });
});

/* MESSAGES */
app.post('/send-message', async (req, res) => {
  const { adminEmail, recipients, title, content, senderName, allowReply } = req.body;
  if (!(await getAdmin(adminEmail))) return res.status(403).json({ error: 'Admin only' });
  if (!content || !senderName) return res.status(400).json({ error: 'Content required' });

  let targets = [];
  if (recipients === 'all') {
    const { data } = await supabase.from('users').select('email').neq('role', 'admin');
    targets = (data || []).map(u => u.email);
  } else if (Array.isArray(recipients)) targets = recipients;
  else if (typeof recipients === 'string') targets = [recipients];
  if (!targets.length) return res.status(400).json({ error: 'No recipients' });

  const rows = targets.map(to => ({
    from_email: adminEmail, to_email: to, title: title || 'Message from MRC',
    content, sender_display_name: senderName, allow_reply: allowReply || false,
    read_status: false, parent_id: null
  }));
  const { error } = await supabase.from('messages').insert(rows);
  if (error) return res.status(500).json({ error: 'Failed: ' + error.message });
  res.json({ success: true, sent: targets.length });
});

app.get('/messages/:email', async (req, res) => {
  const { data, error } = await supabase.from('messages').select('*')
    .or(`to_email.eq.${req.params.email},from_email.eq.${req.params.email}`)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed' });
  res.json(data || []);
});

app.post('/messages/mark-read', async (req, res) => {
  const { email, messageId } = req.body;
  if (!email || !messageId) return res.status(400).json({ error: 'Missing' });
  await supabase.from('messages').update({ read_status: true }).eq('id', messageId).eq('to_email', email);
  res.json({ success: true });
});

app.post('/reply-message', async (req, res) => {
  const { fromEmail, parentId, content } = req.body;
  if (!fromEmail || !parentId || !content) return res.status(400).json({ error: 'Missing' });
  const { data: p } = await supabase.from('messages').select('from_email, title').eq('id', parentId).maybeSingle();
  if (!p) return res.status(404).json({ error: 'Parent not found' });
  const { error } = await supabase.from('messages').insert([{
    from_email: fromEmail, to_email: p.from_email,
    title: 'Re: ' + (p.title || 'Message'), content,
    sender_display_name: null, allow_reply: false, read_status: false, parent_id: parentId
  }]);
  if (error) return res.status(500).json({ error: 'Failed' });
  res.json({ success: true });
});

/* MODES */
app.get('/modes', async (req, res) => {
  const country = req.query.country || '';
  let q = supabase.from('modes').select('*').eq('is_active', true);

  if (country.toLowerCase() === 'euro area') q = q.ilike('name', 'Euro%');
  else {
    const prefixMap = {
      'Nigeria': 'Nigeria', 'USA': 'USA', 'United States': 'USA', 'Canada': 'Canada',
      'UK': 'UK', 'United Kingdom': 'UK', 'Australia': 'Australia', 'Brazil': 'Brazil',
      'Germany': 'Germany', 'Portugal': 'Portugal', 'UAE': 'UAE',
      'South Africa': 'South Africa', 'India': 'India', 'Singapore': 'Singapore'
    };
    const prefix = prefixMap[country];
    if (prefix) q = q.ilike('name', prefix + '%');
  }
  const { data, error } = await q.order('access_amount', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

/* USER'S MODE + WEEKLY STATUS */
app.get('/user-mode/:email', async (req, res) => {
  const { data: um } = await supabase.from('user_modes').select('*, modes(*)')
    .eq('user_email', req.params.email).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!um) return res.json(null);

  let todayEarnings = 0, tasksDoneToday = 0;
  if (um.status === 'COMPLETED') {
    const today = new Date().toISOString().split('T')[0];
    const { data: tp } = await supabase.from('task_completions').select('*')
      .eq('user_email', req.params.email).eq('mode_id', um.mode_id).eq('task_date', today).maybeSingle();
    if (tp) { todayEarnings = tp.earnings || 0; tasksDoneToday = tp.tasks_completed || 0; }
  }
  res.json({ ...um, todayEarnings, tasksDoneToday });
});

/* WEEKLY PAYOUT STATUS */
app.get('/weekly-status/:email', async (req, res) => {
  const { data: um } = await supabase.from('user_modes').select('*, modes(*)')
    .eq('user_email', req.params.email).eq('status', 'COMPLETED').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!um) return res.json(null);

  const { data: payouts } = await supabase.from('payouts').select('*')
    .eq('user_email', req.params.email).order('created_at', { ascending: false }).limit(20);

  const totalPaid = (payouts || []).filter(p => p.status === 'PAID').reduce((s, p) => s + (p.amount || 0), 0);
  const nextPayoutDate = um.next_payout_at ? new Date(um.next_payout_at) : null;

  res.json({
    weeklyAmount: um.weekly_payout_amount || 0,
    lastPayoutAt: um.last_payout_at,
    nextPayoutAt: um.next_payout_at,
    totalPaidOut: totalPaid,
    currencySymbol: um.modes?.currency_symbol || '₦',
    payouts: payouts || []
  });
});

/* ============================================================
   ACTIVATE MODE — "Activate and Send"
   ============================================================ */
app.post('/activate-mode', async (req, res) => {
  try {
    const { email, modeId } = req.body;
    if (!email || !modeId) return res.status(400).json({ error: 'Missing fields' });

    const { data: mode } = await supabase.from('modes').select('*').eq('id', modeId).maybeSingle();
    if (!mode) return res.status(404).json({ error: 'Mode not found' });
    if (!mode.is_active) return res.status(400).json({ error: 'Mode not available' });

    const { data: user } = await supabase.from('users').select('balance, frozen, currency_symbol').eq('email', email).maybeSingle();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.frozen) return res.status(403).json({ error: 'Account frozen. Contact support.' });

    const { data: existing } = await supabase.from('user_modes').select('id, status')
      .eq('user_email', email).in('status', ['PENDING', 'PROCESSING', 'COMPLETED']).maybeSingle();
    if (existing) return res.status(400).json({ error: 'You already have a mode with status: ' + existing.status });

    const currentBalance = user.balance || 0;
    if (currentBalance < mode.access_amount) {
      return res.status(400).json({
        error: 'Insufficient balance. You need ' + mode.currency_symbol + mode.access_amount.toLocaleString() +
               ' but have ' + mode.currency_symbol + currentBalance.toLocaleString(),
        currentBalance, required: mode.access_amount
      });
    }

    const newBalance = currentBalance - mode.access_amount;
    await supabase.from('users').update({ balance: newBalance }).eq('email', email);

    const reference = 'MRC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const now = new Date();
    const nextPayout = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data: userMode, error: umErr } = await supabase.from('user_modes')
      .insert([{
        user_email: email, mode_id: modeId, status: 'PROCESSING',
        tasks_unlocked: false,
        weekly_payout_amount: 0,
        next_payout_at: nextPayout.toISOString()
      }])
      .select().single();
    if (umErr) {
      await supabase.from('users').update({ balance: currentBalance }).eq('email', email);
      return res.status(500).json({ error: 'Activation failed: ' + umErr.message });
    }

    await supabase.from('transactions').insert([{
      user_email: email, type: 'mode_activation',
      amount: -mode.access_amount,
      currency_code: mode.currency_code, currency_symbol: mode.currency_symbol,
      status: 'PROCESSING', reference,
      metadata: {
        mode_id: modeId, mode_name: mode.name, user_mode_id: userMode.id,
        previous_balance: currentBalance, new_balance: newBalance
      }
    }]);

    await supabase.from('messages').insert([{
      from_email: 'admin@mrc.com', to_email: email,
      title: 'Mode Activation — ' + mode.name,
      content: 'Your request to activate ' + mode.name + ' has been received and sent for processing.\n\n' +
               'Amount: ' + mode.currency_symbol + mode.access_amount.toLocaleString() + '\n' +
               'Reference: ' + reference + '\n\n' +
               'It may take up to 8 hours to reflect due to payment and verification processing. ' +
               'You will be notified once complete.',
      sender_display_name: 'MRC Customer Service',
      allow_reply: true, read_status: false, parent_id: null
    }]);

    return res.json({
      success: true, reference, status: 'PROCESSING',
      newBalance,
      message: 'Your payment is being processed. It may take up to 8 hours to reflect due to payment and verification processing.',
      details: { previousBalance: currentBalance, newBalance, deducted: mode.access_amount }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

/* TRANSACTIONS */
app.get('/transactions/:email', async (req, res) => {
  const { data } = await supabase.from('transactions').select('*')
    .eq('user_email', req.params.email).order('created_at', { ascending: false });
  res.json(data || []);
});

/* COMPLETE TASK */
app.post('/complete-task', async (req, res) => {
  const { email, modeId, tasks } = req.body;
  if (!email || !modeId || !tasks) return res.status(400).json({ error: 'Missing fields' });
  const taskCount = parseInt(tasks);
  if (!taskCount || taskCount < 1) return res.status(400).json({ error: 'Invalid task count' });

  const { data: um } = await supabase.from('user_modes').select('*')
    .eq('user_email', email).eq('mode_id', modeId).eq('status', 'COMPLETED').maybeSingle();
  if (!um) return res.status(403).json({ error: 'No active mode' });
  if (um.expires_at && new Date(um.expires_at) < new Date()) return res.status(403).json({ error: 'Mode expired' });

  const { data: mode } = await supabase.from('modes').select('*').eq('id', modeId).maybeSingle();
  if (!mode) return res.status(404).json({ error: 'Mode not found' });

  const today = new Date().toISOString().split('T')[0];
  const { data: ex } = await supabase.from('task_completions').select('*')
    .eq('user_email', email).eq('mode_id', modeId).eq('task_date', today).maybeSingle();
  const already = ex ? ex.tasks_completed : 0;
  const remaining = Math.max(0, mode.tasks_per_day - already);
  if (taskCount > remaining) return res.status(400).json({ error: 'Only ' + remaining + ' more allowed', remaining });

  const earnings = taskCount * mode.reward_per_task;

  if (ex) {
    await supabase.from('task_completions').update({
      tasks_completed: already + taskCount, earnings: (ex.earnings || 0) + earnings
    }).eq('id', ex.id);
  } else {
    await supabase.from('task_completions').insert([{
      user_email: email, mode_id: modeId, task_date: today, tasks_completed: taskCount, earnings
    }]);
  }

  const { data: u } = await supabase.from('users').select('balance').eq('email', email).maybeSingle();
  const newBalance = (u?.balance || 0) + earnings;
  await supabase.from('users').update({ balance: newBalance }).eq('email', email);

  await supabase.from('transactions').insert([{
    user_email: email, type: 'task_earning', amount: earnings,
    currency_code: mode.currency_code, currency_symbol: mode.currency_symbol,
    status: 'COMPLETED', metadata: { mode_id: modeId, tasks: taskCount }
  }]);

  res.json({ success: true, earnings, newBalance, remaining: remaining - taskCount });
});

app.get('/task-progress/:email/:modeId', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase.from('task_completions').select('*')
    .eq('user_email', req.params.email).eq('mode_id', req.params.modeId).eq('task_date', today).maybeSingle();
  res.json(data || { tasks_completed: 0, earnings: 0 });
});

/* ============================================================
   ADMIN
   ============================================================ */
app.post('/admin/users', async (req, res) => {
  const { adminEmail, action, targetEmail, data } = req.body;
  if (!(await getAdmin(adminEmail))) return res.status(403).json({ error: 'Admin only' });

  if (action === 'list') {
    const { data: users } = await supabase.from('users').select('*').neq('role', 'admin').order('created_at', { ascending: false });
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
    const old = user.balance || 0;
    const nb = old + amount;
    await supabase.from('users').update({ balance: nb }).eq('email', targetEmail);
    await supabase.from('balance_logs').insert([{ user_email: targetEmail, admin_email: adminEmail, old_balance: old, new_balance: nb, amount, note: data.note || '' }]);
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'edit_balance', target_email: targetEmail, details: { old, new: nb, amount } }]);
    return res.json({ success: true, newBalance: nb });
  }

  if (action === 'freeze' || action === 'unfreeze') {
    const frozen = action === 'freeze';
    await supabase.from('users').update({ frozen }).eq('email', targetEmail);
    return res.json({ success: true });
  }

  if (action === 'pendingDeposits') {
    const { data } = await supabase.from('deposits').select('*').eq('status', 'pending').order('created_at', { ascending: true });
    return res.json(data || []);
  }

  if (action === 'completeDeposit') {
    const { depositId } = data;
    await supabase.from('deposits').update({ status: 'completed' }).eq('id', depositId);
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

  if (action === 'listModes') {
    const { data } = await supabase.from('modes').select('*').order('created_at', { ascending: false });
    return res.json(data || []);
  }

  if (action === 'pendingModes') {
    const { data } = await supabase.from('user_modes').select('*, modes(*)')
      .in('status', ['PENDING', 'PROCESSING']).order('created_at', { ascending: true });
    return res.json(data || []);
  }

  /* APPROVE MODE */
  if (action === 'approveMode') {
    const { data: um } = await supabase.from('user_modes').select('*, modes(*)').eq('id', data.userModeId).maybeSingle();
    if (!um) return res.status(404).json({ error: 'Not found' });
    if (um.status === 'COMPLETED') return res.status(400).json({ error: 'Already active' });

    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + (um.modes.duration_months || 12));
    const nextPayout = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    const weeklyAmount = data.weeklyAmount !== undefined ? parseFloat(data.weeklyAmount) : 0;

    await supabase.from('user_modes').update({
      status: 'COMPLETED',
      activated_at: start.toISOString(),
      expires_at: end.toISOString(),
      tasks_unlocked: true,
      weekly_payout_amount: weeklyAmount,
      next_payout_at: nextPayout.toISOString()
    }).eq('id', data.userModeId);

    const { data: tx } = await supabase.from('transactions').select('reference')
      .eq('user_email', um.user_email).eq('type', 'mode_activation').eq('status', 'PROCESSING')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (tx) await supabase.from('transactions').update({ status: 'COMPLETED' }).eq('reference', tx.reference);

    await supabase.from('messages').insert([{
      from_email: 'admin@mrc.com', to_email: um.user_email,
      title: 'Mode Activated — ' + um.modes.name,
      content: 'Your ' + um.modes.name + ' is now ACTIVE.\n\n' +
               'Weekly payout: ' + um.modes.currency_symbol + weeklyAmount.toLocaleString() + '\n' +
               'Next payout: ' + nextPayout.toLocaleDateString() + '\n\n' +
               'You will receive your weekly payout automatically.',
      sender_display_name: 'MRC Customer Care',
      allow_reply: true, read_status: false, parent_id: null
    }]);

    return res.json({ success: true });
  }

  /* REJECT MODE — refund */
  if (action === 'rejectMode') {
    const { data: um } = await supabase.from('user_modes').select('*, modes(*)').eq('id', data.userModeId).maybeSingle();
    if (!um) return res.status(404).json({ error: 'Not found' });
    if (um.status === 'COMPLETED') return res.status(400).json({ error: 'Cannot reject active mode' });

    const refund = um.modes.access_amount;
    const { data: user } = await supabase.from('users').select('balance').eq('email', um.user_email).maybeSingle();
    const newBal = (user?.balance || 0) + refund;
    await supabase.from('users').update({ balance: newBal }).eq('email', um.user_email);

    await supabase.from('user_modes').update({ status: 'FAILED', tasks_unlocked: false }).eq('id', data.userModeId);

    const { data: tx } = await supabase.from('transactions').select('reference')
      .eq('user_email', um.user_email).eq('type', 'mode_activation').eq('status', 'PROCESSING')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (tx) await supabase.from('transactions').update({ status: 'FAILED' }).eq('reference', tx.reference);

    await supabase.from('transactions').insert([{
      user_email: um.user_email, type: 'mode_refund',
      amount: refund, currency_code: um.modes.currency_code, currency_symbol: um.modes.currency_symbol,
      status: 'COMPLETED', metadata: { reason: 'Admin rejected' }
    }]);

    await supabase.from('messages').insert([{
      from_email: 'admin@mrc.com', to_email: um.user_email,
      title: 'Mode Activation Failed',
      content: 'Your activation for ' + um.modes.name + ' could not be completed.\n\n' +
               'Refunded: ' + um.modes.currency_symbol + refund.toLocaleString(),
      sender_display_name: 'MRC Customer Care',
      allow_reply: true, read_status: false, parent_id: null
    }]);

    return res.json({ success: true, refunded: refund });
  }

  /* SET WEEKLY PAYOUT AMOUNT */
  if (action === 'setWeeklyPayout') {
    const { userModeId, amount } = data;
    const amt = parseFloat(amount) || 0;
    await supabase.from('user_modes').update({ weekly_payout_amount: amt }).eq('id', userModeId);
    await supabase.from('audit_logs').insert([{ admin_email: adminEmail, action: 'set_weekly_payout', target_email: null, details: { userModeId, amount: amt } }]);
    return res.json({ success: true });
  }

  /* SEND WEEKLY PAYOUT (adds money to balance + records payout) */
  if (action === 'sendWeeklyPayout') {
    const { userModeId } = data;
    const { data: um } = await supabase.from('user_modes').select('*, modes(*)').eq('id', userModeId).maybeSingle();
    if (!um) return res.status(404).json({ error: 'Not found' });
    if (um.status !== 'COMPLETED') return res.status(400).json({ error: 'Mode is not active' });

    const amount = um.weekly_payout_amount || 0;
    if (amount <= 0) return res.status(400).json({ error: 'Weekly amount not set' });

    const { data: user } = await supabase.from('users').select('balance').eq('email', um.user_email).maybeSingle();
    const newBal = (user?.balance || 0) + amount;
    await supabase.from('users').update({ balance: newBal }).eq('email', um.user_email);

    const now = new Date();
    const nextPayout = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await supabase.from('payouts').insert([{
      user_email: um.user_email, user_mode_id: userModeId,
      amount, currency_code: um.modes.currency_code, currency_symbol: um.modes.currency_symbol,
      status: 'PAID', paid_date: now.toISOString(), scheduled_date: now.toISOString()
    }]);

    await supabase.from('user_modes').update({
      last_payout_at: now.toISOString(),
      next_payout_at: nextPayout.toISOString(),
      total_paid_out: (um.total_paid_out || 0) + amount
    }).eq('id', userModeId);

    await supabase.from('transactions').insert([{
      user_email: um.user_email, type: 'weekly_payout',
      amount, currency_code: um.modes.currency_code, currency_symbol: um.modes.currency_symbol,
      status: 'COMPLETED', metadata: { user_mode_id: userModeId, week: now.toISOString() }
    }]);

    await supabase.from('messages').insert([{
      from_email: 'admin@mrc.com', to_email: um.user_email,
      title: 'Weekly Payout Received',
      content: 'You have received your weekly payout of ' + um.modes.currency_symbol + amount.toLocaleString() + '.\n\n' +
               'Next payout: ' + nextPayout.toLocaleDateString(),
      sender_display_name: 'MRC Customer Care',
      allow_reply: true, read_status: false, parent_id: null
    }]);

    await supabase.from('audit_logs').insert([{
      admin_email: adminEmail, action: 'weekly_payout_sent',
      target_email: um.user_email, details: { amount, userModeId }
    }]);

    return res.json({ success: true, amount, newBalance: newBal });
  }

  /* LIST ALL ACTIVE MODES WITH WEEKLY INFO */
  if (action === 'activeModes') {
    const { data } = await supabase.from('user_modes').select('*, modes(*)')
      .eq('status', 'COMPLETED').order('created_at', { ascending: false });
    return res.json(data || []);
  }

  return res.status(400).json({ error: 'Invalid action' });
});

app.listen(PORT, () => {
  console.log('🚀 MRC server running at http://localhost:' + PORT);
  console.log('📧 Admin: admin@mrc.com / admin123');
});
