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
// COUNTRY → CURRENCY MAP
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
// AUTH HELPERS
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

    // Check existing
    const { data: existing } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
    if (existing) {
      return res.status(400).json({ error: 'Email already registered. Please log in.' });
    }

    const currency = getCurrency(country);

    const newUser = {
      email,
      password,
      name,
      phone: phone || '',
      country,
      address,
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
        hint: error.hint || null
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
  });
});

// ============================================================
// THEME PREFERENCE
// ============================================================
app.post('/user/theme', async (req, res) => {
  const { email, theme } = req.body;
  if (!email || !['dark', 'light'].includes(theme)) {
    return res.status(400).json({ error: 'Invalid theme' });
  }
  await supabase.from('users').update({ theme }).eq('email', email);
  res.json({ success: true });
});

// ============================================================
// DEPOSIT REQUEST (user → admin)
// ============================================================
app.post('/request-deposit', async (req, res) => {
  const { email, amount } = req.body;
  if (!email || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const { error } = await supabase.from('deposits').insert([
    { user_email: email, amount, status: 'pending' }
  ]);
  if (error) return res.status(500).json({ error: 'Deposit request failed: ' + error.message });
  res.json({ success: true, message: 'Deposit request sent. You will receive instructions shortly.' });
});

// ============================================================
// MESSAGES — SEND (admin only, supports individual/multiple/all)
// ============================================================
app.post('/send-message', async (req, res) => {
  const { adminEmail, recipients, title, content, senderName, allowReply } = req.body;

  if (!(await getAdmin(adminEmail))) return res.status(403).json({ error: 'Admin only' });
  if (!content || !senderName) return res.status(400).json({ error: 'Message content and sender required' });

  let targetEmails = [];
  if (recipients === 'all') {
    const { data: users } = await supabase.from('users').select('email').neq('role', 'admin');
    targetEmails = (users || []).map(u => u.email);
  } else if (Array.isArray(recipients)) {
    targetEmails = recipients;
  } else if (typeof recipients === 'string') {
    targetEmails = [recipients];
  }

  if (targetEmails.length === 0) return res.status(400).json({ error: 'No recipients selected' });

  const rows = targetEmails.map(to => ({
    from_email: adminEmail,
    to_email: to,
    title: title || 'Message from MRC',
    content,
    sender_display_name: senderName,
    allow_reply: allowReply || false,
    read_status: false,
    parent_id: null,
  }));

  const { error } = await supabase.from('messages').insert(rows);
  if (error) return res.status(500).json({ error: 'Failed to send message: ' + error.message });

  // Audit
  await supabase.from('audit_logs').insert([{
    admin_email: adminEmail,
    action: 'send_message',
    target_email: recipients === 'all' ? 'ALL' : targetEmails.join(','),
    details: { title, content, senderName, allowReply, count: targetEmails.length }
  }]);

  res.json({ success: true, sent: targetEmails.length });
});

// ============================================================
// MESSAGES — GET USER'S INBOX (permanent history)
// ============================================================
app.get('/messages/:email', async (req, res) => {
  const email = req.params.email;
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(`to_email.eq.${email},from_email.eq.${email}`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch messages' });
  res.json(data || []);
});

// MARK MESSAGE AS READ
app.post('/messages/mark-read', async (req, res) => {
  const { email, messageId } = req.body;
  if (!email || !messageId) return res.status(400).json({ error: 'Missing fields' });
  const { error } = await supabase
    .from('messages')
    .update({ read_status: true })
    .eq('id', messageId)
    .eq('to_email', email);
  if (error) return res.status(500).json({ error: 'Failed to mark read' });
  res.json({ success: true });
});

// ============================================================
// USER REPLY
// ============================================================
app.post('/reply-message', async (req, res) => {
  const { fromEmail, parentId, content } = req.body;
  if (!fromEmail || !parentId || !content) return res.status(400).json({ error: 'Missing fields' });

  const { data: parent } = await supabase.from('messages').select('from_email, title').eq('id', parentId).maybeSingle();
  if (!parent) return res.status(404).json({ error: 'Parent message not found' });

  const { error } = await supabase.from('messages').insert([{
    from_email: fromEmail,
    to_email: parent.from_email,
    title: 'Re: ' + (parent.title || 'Message'),
    content,
    sender_display_name: null,
    allow_reply: false,
    read_status: false,
    parent_id: parentId,
  }]);
  if (error) return res.status(500).json({ error: 'Failed to send reply' });
  res.json({ success: true });
});

// ============================================================
// ADMIN — ALL USER MANAGEMENT (server-side protected)
// ============================================================
app.post('/admin/users', async (req, res) => {
  const { adminEmail, action, targetEmail, data } = req.body;

  if (!(await getAdmin(adminEmail))) {
    return res.status(403).json({ error: 'Admin only — unauthorized' });
  }

  // LIST USERS (full details)
  if (action === 'list') {
    const { data: users, error } = await supabase.from('users').select('*').neq('role', 'admin').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch users' });
    return res.json(users || []);
  }

  // GET SINGLE USER FULL DETAIL
  if (action === 'get') {
    const { data: user } = await supabase.from('users').select('*').eq('email', targetEmail).maybeSingle();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { data: msgs } = await supabase.from('messages').select('*').or(`to_email.eq.${targetEmail},from_email.eq.${targetEmail}`).order('created_at', { ascending: false });
    const { data: logs } = await supabase.from('balance_logs').select('*').eq('user_email', targetEmail).order('created_at', { ascending: false });

    return res.json({ user, messages: msgs || [], balanceLogs: logs || [] });
  }

  // EDIT BALANCE (with audit log)
  if (action === 'editBalance') {
    const amount = parseFloat(data.amount) || 0;
    if (amount === 0) return res.status(400).json({ error: 'Amount must be non-zero' });

    const { data: user } = await supabase.from('users').select('balance').eq('email', targetEmail).maybeSingle();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const oldBalance = user.balance || 0;
    const newBalance = oldBalance + amount;

    const { error: upErr } = await supabase.from('users').update({ balance: newBalance }).eq('email', targetEmail);
    if (upErr) return res.status(500).json({ error: 'Balance update failed: ' + upErr.message });

    await supabase.from('balance_logs').insert([{
      user_email: targetEmail,
      admin_email: adminEmail,
      old_balance: oldBalance,
      new_balance: newBalance,
      amount,
      note: data.note || ''
    }]);

    await supabase.from('audit_logs').insert([{
      admin_email: adminEmail,
      action: 'edit_balance',
      target_email: targetEmail,
      details: { oldBalance, newBalance, amount }
    }]);

    return res.json({ success: true, newBalance });
  }

  // FREEZE / UNFREEZE
  if (action === 'freeze' || action === 'unfreeze') {
    const frozen = action === 'freeze';
    const { error } = await supabase.from('users').update({ frozen }).eq('email', targetEmail);
    if (error) return res.status(500).json({ error: 'Update failed' });

    await supabase.from('audit_logs').insert([{
      admin_email: adminEmail,
      action: frozen ? 'freeze_user' : 'unfreeze_user',
      target_email: targetEmail,
      details: {}
    }]);
    return res.json({ success: true });
  }

  // PENDING DEPOSITS
  if (action === 'pendingDeposits') {
    const { data } = await supabase.from('deposits').select('*').eq('status', 'pending').order('created_at', { ascending: true });
    return res.json(data || []);
  }

  // COMPLETE DEPOSIT
  if (action === 'completeDeposit') {
    const { depositId } = data;
    if (!depositId) return res.status(400).json({ error: 'Deposit ID required' });
    const { data: dep } = await supabase.from('deposits').select('user_email, amount').eq('id', depositId).maybeSingle();
    if (!dep) return res.status(404).json({ error: 'Deposit not found' });

    await supabase.from('deposits').update({ status: 'completed' }).eq('id', depositId);
    await supabase.from('audit_logs').insert([{
      admin_email: adminEmail,
      action: 'complete_deposit',
      target_email: dep.user_email,
      details: { amount: dep.amount }
    }]);
    return res.json({ success: true });
  }

  // GET ALL MESSAGES
  if (action === 'getMessages') {
    const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false });
    return res.json(data || []);
  }

  // GET AUDIT LOGS
  if (action === 'getAuditLogs') {
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
    return res.json(data || []);
  }

  // GET BALANCE LOGS
  if (action === 'getBalanceLogs') {
    const { data } = await supabase.from('balance_logs').select('*').order('created_at', { ascending: false }).limit(200);
    return res.json(data || []);
  }

  return res.status(400).json({ error: 'Invalid action' });
});

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 MRC server running at http://localhost:${PORT}`);
  console.log('👤 User app:  http://localhost:3000/');
  console.log('🔐 Admin panel: http://localhost:3000/admin.html');
  console.log('📧 Admin login: admin@mrc.com / admin123');
});