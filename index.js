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

// Litmus log to confirm updated handler
console.log('🚨 Running UPDATED handler 🚨');

// — CORS & JSON parsing — //
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

// ensure upload dir
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// health-check
app.get('/', (req, res) => {
  res.json({
    status: 'OpenAI Chatbot API running',
    endpoints: { chat: '/chat', image: '/analyze-wix-image' }
  });
});

// serve images
app.get('/uploads/:file', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.file);
  fs.existsSync(fp) ? res.sendFile(fp) : res.status(404).send('Not found');
});

// — TEXT CHAT — //
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // 1) create thread
    console.log('→ THREAD CREATE PAYLOAD:', { assistant_id: OPENAI_ASSISTANT_ID });
    const thr = await fetch(`${OPENAI_BASE}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!thr.ok) throw new Error(await thr.text());
    const { id: thread_id } = await thr.json();

    // 2) post message
    console.log('→ POST TEXT MESSAGE:', thread_id, message);
    const msgRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: thr.headers,
      body: JSON.stringify({ role: 'user', content: message })
    });
    if (!msgRes.ok) throw new Error(await msgRes.text());

    // 3) run assistant
    console.log('→ RUN ASSISTANT:', thread_id, OPENAI_ASSISTANT_ID);
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: thr.headers,
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    let { id: run_id, status } = await runRes.json();
    console.log('← INITIAL RUN STATUS:', status);

    // 4) poll
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const poll = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: thr.headers
      });
      if (!poll.ok) throw new Error(await poll.text());
      status = (await poll.json()).status;
    }

    // 5) fetch reply
    console.log('→ FETCHING MESSAGES:', thread_id);
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: thr.headers
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

// — IMAGE ANALYSIS — //
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Provide imageUrl or imageBase64' });
  }

  try {
    // save image
    let finalImageUrl;
    if (imageBase64) {
      const buf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    } else {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Remote fetch failed');
      const buf = await imgRes.buffer();
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    }

    // 1) create thread
    console.log('→ THREAD CREATE FOR IMAGE:', { assistant_id: OPENAI_ASSISTANT_ID });
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

    // 2) post user + attachment
    const payload = {
      role:        'user',
      content:     message || '',
      attachments: [{ type:'image_url', image_url:{ url:finalImageUrl, detail:'high' }}]
    };
    console.log('→ POST IMAGE MESSAGE:', thread_id, JSON.stringify(payload, null,2));
    const postRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: thrRes.headers,
      body: JSON.stringify(payload)
    });
    if (!postRes.ok) throw new Error(await postRes.text());

    // 3) run assistant
    console.log('→ RUN ASSISTANT ON IMAGE THREAD:', thread_id);
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: thrRes.headers,
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    let { id: run_id, status } = await runRes.json();
    console.log('← IMAGE RUN STATUS:', status);

    // 4) poll
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: thrRes.headers
      });
      if (!p.ok) throw new Error(await p.text());
      status = (await p.json()).status;
    }

    // 5) fetch and reply
    console.log('→ FETCHING IMAGE MESSAGES:', thread_id);
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: thrRes.headers
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

// global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal error', details: err.message });
});

// start server
app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
  if (!OPENAI_API_KEY)      console.warn('⚠️ OPENAI_API_KEY missing!');
  if (!OPENAI_ASSISTANT_ID) console.warn('⚠️ OPENAI_ASSISTANT_ID missing!');
});
