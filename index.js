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

// CORS & body parsing
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));

// ensure upload dir
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// health check
app.get('/', (_, res) => {
  res.json({ status: 'running', endpoints: { chat:'/chat', image:'/analyze-wix-image' }});
});

// serve uploads
app.get('/uploads/:f', (req, res) => {
  const file = path.join(UPLOAD_DIR, req.params.f);
  fs.existsSync(file) ? res.sendFile(file) : res.sendStatus(404);
});

// TEXT CHAT
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'no message' });

  try {
    // 1) create thread (assistant_id here)
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

    // 2) post user message
    const postRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: thrRes.headers,
      body: JSON.stringify({ role: 'user', content: message })
    });
    if (!postRes.ok) throw new Error(await postRes.text());

    // 3) run assistant (empty body)
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: thrRes.headers,
      body: JSON.stringify({})
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    let { id: run_id, status } = await runRes.json();

    // 4) poll
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: thrRes.headers
      });
      if (!p.ok) throw new Error(await p.text());
      status = (await p.json()).status;
    }

    // 5) fetch assistant reply
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: thrRes.headers
    });
    if (!allRes.ok) throw new Error(await allRes.text());
    const { data: msgs } = await allRes.json();
    const reply = msgs.reverse().find(m => m.role === 'assistant')?.content || '';
    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'chat failed', details: err.message });
  }
});

// IMAGE ANALYSIS
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message = '' } = req.body;
  if (!imageUrl && !imageBase64) return res.status(400).json({ error: 'no image' });

  try {
    // save image locally
    let finalUrl;
    if (imageBase64) {
      const b = Buffer.from(imageBase64.split(',')[1], 'base64');
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), b);
      finalUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    } else {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('remote fetch failed');
      const b = await imgRes.buffer();
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), b);
      finalUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    }

    // 1) create thread
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

    // 2) post user + image
    const postRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: thrRes.headers,
      body: JSON.stringify({
        role: 'user',
        content: message,
        attachments: [{ type: 'image_url', image_url: { url: finalUrl, detail: 'high' } }]
      })
    });
    if (!postRes.ok) throw new Error(await postRes.text());

    // 3) run assistant (empty body)
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: thrRes.headers,
      body: JSON.stringify({})
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    let { id: run_id, status } = await runRes.json();

    // 4) poll
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: thrRes.headers
      });
      if (!p.ok) throw new Error(await p.text());
      status = (await p.json()).status;
    }

    // 5) fetch assistant reply
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: thrRes.headers
    });
    if (!allRes.ok) throw new Error(await allRes.text());
    const { data: msgs } = await allRes.json();
    const reply = msgs.reverse().find(m => m.role === 'assistant')?.content || '';
    res.json({ reply });

  } catch (err) {
    console.error('Image analysis error:', err);
    res.status(500).json({ error: 'img failed', details: err.message });
  }
});

// global error handler & start
app.use((e, req, res, next) => {
  console.error('Unhandled error:', e);
  res.status(500).json({ error: 'internal', details: e.message });
});
app.listen(PORT, () => console.log(`🚀 live on ${PORT}`));
