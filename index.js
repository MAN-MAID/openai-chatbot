// index.js
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = '/tmp/uploads';

const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const ASSISTANTS_HEADER   = { 'OpenAI-Beta': 'assistants=v2' };
const OPENAI_BASE         = 'https://api.openai.com/v1';

//— manual CORS handler —//
// allow every origin (or you can echo req.headers.origin)
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// health check
app.get('/', (req, res) => {
  res.json({
    status: 'OpenAI Chatbot API is running',
    endpoints: { chat: '/chat', imageAnalysis: '/analyze-wix-image' }
  });
});

// serve uploaded images
app.get('/uploads/:filename', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.filename);
  fs.existsSync(fp) ? res.sendFile(fp) : res.status(404).send('Not found');
});

// — Chat via your custom Assistant — 
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // 1) create thread
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

    // 2) post user msg
    await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: thr.headers,
      body: JSON.stringify({ role: 'user', content: message })
    }).then(r => { if (!r.ok) throw new Error(await r.text()) });

    // 3) run assistant
    const run = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: thr.headers,
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!run.ok) throw new Error(await run.text());
    const { id: run_id, status: st0 } = await run.json();

    // 4) poll
    let status = st0;
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, { headers: thr.headers });
      if (!p.ok) throw new Error(await p.text());
      status = (await p.json()).status;
    }

    // 5) fetch messages
    const all = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, { headers: thr.headers });
    if (!all.ok) throw new Error(await all.text());
    const { data: msgs } = await all.json();
    const reply = msgs.reverse().find(m => m.role==='assistant')?.content || '';

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});

// — Image analysis (unchanged logic) — 
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Either imageUrl or imageBase64 required' });
  }

  try {
    // save incoming image
    let finalImageUrl;
    if (imageBase64) {
      const b = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), b);
      finalImageUrl = `${process.env.SERVER_URL || 'https://openai-chatbot-513z.onrender.com'}/uploads/${fn}`;
    } else {
      const r = await fetch(imageUrl, { headers: {
        'User-Agent':'Mozilla/5.0','Accept':'image/*','Referer':'https://www.man-maid.co.uk'
      }});
      if (!r.ok) throw new Error('Remote fetch failed');
      const buf = await r.buffer();
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL || 'https://openai-chatbot-513z.onrender.com'}/uploads/${fn}`;
    }

    // call vision
    const vis = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user',    content: message||'What do you see?' },
          { type: 'image_url', image_url: { url: finalImageUrl, detail:'high' } }
        ],
        max_tokens: 500
      })
    });
    if (!vis.ok) throw new Error(await vis.text());
    const j = await vis.json();
    res.json({ reply: j.choices[0].message.content });
  } catch (err) {
    console.error('Image error:', err);
    res.status(500).json({ error: 'Image analysis failed', details: err.message });
  }
});

// fallback error handler
app.use((e,req,res,_)=>{
  console.error('Unhandled:',e);
  res.status(500).json({ error:'Internal error', details:e.message });
});

// start
app.listen(PORT, ()=> {
  console.log(`🚀 Server on port ${PORT}`);
  if (!OPENAI_API_KEY)      console.warn('⚠️ MISSING OPENAI_API_KEY');
  if (!OPENAI_ASSISTANT_ID) console.warn('⚠️ MISSING OPENAI_ASSISTANT_ID');
});
