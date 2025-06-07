// index.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = '/tmp/uploads';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const ASSISTANTS_HEADER = { 'OpenAI-Beta': 'assistants=v2' };
const OPENAI_BASE = 'https://api.openai.com/v1';

// ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// CORS setup (reflects request origin)
app.use(cors({
  origin: true,               // echo back the request Origin
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options('*', cors());

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
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  fs.existsSync(filePath)
    ? res.sendFile(filePath)
    : res.status(404).send('File not found');
});

// ———————————————
// Chat via your custom Assistant
// ———————————————
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // 1. create thread
    const thrRes = await fetch(`${OPENAI_BASE}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!thrRes.ok) throw new Error(await thrRes.text());
    const { id: thread_id } = await thrRes.json();

    // 2. post user message
    await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ role: 'user', content: message })
    }).then(r => { if (!r.ok) throw new Error('Failed to post message') });

    // 3. run assistant
    const runRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if (!runRes.ok) throw new Error(await runRes.text());
    const { id: run_id, status: initStatus } = await runRes.json();

    // 4. poll until done
    let status = initStatus;
    while (['queued','in_progress'].includes(status)) {
      await new Promise(r => setTimeout(r, 1000));
      const poll = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER }
      });
      if (!poll.ok) throw new Error(await poll.text());
      status = (await poll.json()).status;
    }

    // 5. fetch messages & return assistant’s reply
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...ASSISTANTS_HEADER }
    });
    if (!allRes.ok) throw new Error(await allRes.text());
    const { data: msgs } = await allRes.json();
    const reply = msgs.reverse().find(m => m.role === 'assistant')?.content || '';

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to process chat request', details: err.message });
  }
});

// ———————————————
// Image analysis
// ———————————————
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Either imageUrl or imageBase64 is required' });
  }

  try {
    let finalImageUrl;
    if (imageBase64) {
      const clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(clean, 'base64');
      const filename = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
      const serverUrl = process.env.SERVER_URL || `https://openai-chatbot-513z.onrender.com`;
      finalImageUrl = `${serverUrl}/uploads/${filename}`;
    } else {
      const imgRes = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*', Referer: 'https://www.man-maid.co.uk' }
      });
      if (!imgRes.ok) throw new Error('Image URL fetch failed');
      const buf = await imgRes.buffer();
      const filename = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
      const serverUrl = process.env.SERVER_URL || `https://openai-chatbot-513z.onrender.com`;
      finalImageUrl = `${serverUrl}/uploads/${filename}`;
    }

    const visionRes = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: message || 'What do you see in this image?' },
          { type: 'image_url', image_url: { url: finalImageUrl, detail: 'high' } }
        ],
        max_tokens: 500
      })
    });
    if (!visionRes.ok) throw new Error(await visionRes.text());
    const visionData = await visionRes.json();
    res.json({ reply: visionData.choices[0].message.content });
  } catch (err) {
    console.error('Image analysis error:', err);
    res.status(500).json({ error: 'Image analysis failed', details: err.message });
  }
});

// global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// start server
app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
  if (!OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY missing!');
  if (!OPENAI_ASSISTANT_ID) console.warn('⚠️ OPENAI_ASSISTANT_ID missing!');
});
