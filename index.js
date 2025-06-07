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

// — manual CORS handler — //
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

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

    // 3) run assistant
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
    const { id: run_id, status: initStatus } = await runRes.json();

    // 4) poll until done
    let status = initStatus;
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(
        `${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`,
        { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER } }
      );
      if (!pollRes.ok) throw new Error(await pollRes.text());
      status = (await pollRes.json()).status;
    }

    // 5) fetch messages & reply
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

// — Image analysis — 
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Either imageUrl or imageBase64 required' });
  }

  try {
    // save the image locally and get a public URL
    let finalImageUrl;
    if (imageBase64) {
      const buf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL || 'https://openai-chatbot-513z.onrender.com'}/uploads/${fn}`;
    } else {
      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent':'Mozilla/5.0', Accept:'image/*', Referer:'https://www.man-maid.co.uk' }
      });
      if (!imgRes.ok) throw new Error('Remote fetch failed');
      const buf = await imgRes.buffer();
      const fn = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, fn), buf);
      finalImageUrl = `${process.env.SERVER_URL || 'https://openai-chatbot-513z.onrender.com'}/uploads/${fn}`;
    }

    // single user message with both text and image attachment
    const visionRes = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text',     text: message || 'What do you see in this image?' },
              { type: 'image_url', image_url: { url: finalImageUrl, detail: 'high' } }
            ]
          }
        ],
        max_tokens: 500
      })
    });
    if (!visionRes.ok) throw new Error(await visionRes.text());
    const { choices } = await visionRes.json();
    res.json({ reply: choices[0].message.content });
  } catch (err) {
    console.error('Image analysis error:', err);
    res.status(500).json({ error: 'Image analysis failed', details: err.message });
  }
});

// fallback error handler
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
