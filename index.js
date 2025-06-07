// index.js
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');
require('dotenv').config();

const app                 = express();
const PORT                = process.env.PORT || 10000;
const UPLOAD_DIR          = '/tmp/uploads';
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const ASSISTANTS_HEADER   = { 'OpenAI-Beta': 'assistants=v2' };
const OPENAI_BASE         = 'https://api.openai.com/v1';

// —— CORS & BODY PARSING —— //
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// —— Ensure upload directory exists —— //
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// —— Health Check —— //
app.get('/', (req, res) => {
  res.json({
    status: 'OpenAI Chatbot API running',
    endpoints: {
      chat: '/chat',
      image: '/analyze-wix-image'
    }
  });
});

// —— Serve uploaded images —— //
app.get('/uploads/:file', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.file);
  fs.existsSync(fp) ? res.sendFile(fp) : res.status(404).send('Not found');
});

// —— TEXT CHAT —— //
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // 1) Create thread
    const thrRes = await fetch(`${OPENAI_BASE}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!thrRes.ok) throw new Error(await thrRes.text());
    const { id: thread_id } = await thrRes.json();

    // 2) Post user message
    const msgRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ role: 'user', content: message })
    });
    if (!msgRes.ok) throw new Error(await msgRes.text());

    // 3) Run assistant
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    const { id: run_id, status } = await runRes.json();

    // 4) Poll
    let st = status;
    while (['queued', 'in_progress'].includes(st)) {
      await new Promise(r => setTimeout(r, 1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER }
      });
      if (!p.ok) throw new Error(await p.text());
      st = (await p.json()).status;
    }

    // 5) Fetch & respond
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER }
    });
    if (!allRes.ok) throw new Error(await allRes.text());
    const { data: msgs } = await allRes.json();
    const reply = msgs.reverse().find(m => m.role === 'assistant')?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});

// —— IMAGE ANALYSIS —— //
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Provide imageUrl or imageBase64' });
  }

  try {
    // Save image and get a public URL
    let finalImageUrl;
    if (imageBase64) {
      const buf = Buffer.from(
        imageBase64.replace(/^data:image\/\w+;base64,/, ''), 
        'base64'
      );
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    } else {
      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent':'Mozilla/5.0' }
      });
      if (!imgRes.ok) throw new Error('Remote fetch failed');
      const buf = await imgRes.buffer();
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    }

    // 1) Create thread
    const thrRes = await fetch(`${OPENAI_BASE}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!thrRes.ok) throw new Error(await thrRes.text());
    const { id: thread_id } = await thrRes.json();

    // 2) Post user message + attachment
    const postRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({
        role:        'user',
        content:     message || '',
        attachments: [
          { type: 'image_url', image_url: { url: finalImageUrl, detail: 'high' } }
        ]
      })
    });
    if (!postRes.ok) throw new Error(await postRes.text());

    // 3) Run assistant
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    const { id: run_id, status } = await runRes.json();

    // 4) Poll
    let st = status;
    while (['queued', 'in_progress'].includes(st)) {
      await new Promise(r => setTimeout(r, 1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER }
      });
      if (!p.ok) throw new Error(await p.text());
      st = (await p.json()).status;
    }

    // 5) Fetch & respond
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER }
    });
    if (!allRes.ok) throw new Error(await allRes.text());
    const { data: msgs } = await allRes.json();
    const reply = msgs.reverse().find(m => m.role === 'assistant')?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('Image analysis error:', err);
    res.status(500).json({ error: 'Image analysis failed', details: err.message });
  }
});

// —— Global error handler —— //
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal error', details: err.message });
});

// —— Start server —— //
app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
  if (!OPENAI_API_KEY)      console.warn('⚠️ MISSING OPENAI_API_KEY');
  if (!OPENAI_ASSISTANT_ID) console.warn('⚠️ MISSING OPENAI_ASSISTANT_ID');
});
