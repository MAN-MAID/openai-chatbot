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
const API_URL             = 'https://api.openai.com/v1/chat/completions';

// CORS + JSON
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));

// upload dir
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// health
app.get('/', (_,res) => {
  res.json({ status:'ok', endpoints:{ chat:'/chat', image:'/analyze-wix-image' } });
});

// serve images
app.get('/uploads/:f', (req,res) => {
  const p = path.join(UPLOAD_DIR, req.params.f);
  fs.existsSync(p) ? res.sendFile(p) : res.sendStatus(404);
});

// CHAT ONLY
app.post('/chat', async (req,res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error:'no message' });
  try {
    const reply = await callAssistant([
      { role:'user', content: message }
    ]);
    res.json({ reply });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error:'chat failed', details:err.message });
  }
});

// IMAGE + CHAT
app.post('/analyze-wix-image', async (req,res) => {
  const { imageUrl, imageBase64, message='' } = req.body;
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error:'provide imageUrl or imageBase64' });
  }

  try {
    // 1) save or proxy image
    let publicUrl;
    if (imageBase64) {
      const data = imageBase64.split(',')[1];
      const buf  = Buffer.from(data, 'base64');
      const fn   = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR,fn), buf);
      publicUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    } else {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error('fetch failed');
      const buf = await resp.buffer();
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR,fn), buf);
      publicUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    }

    // 2) send both text and image as messages
    const msgs = [
      { role:'user', content: message || 'What do you see here?' },
      { role:'user', content: `<image>${publicUrl}</image>` }
    ];
    const reply = await callAssistant(msgs);
    res.json({ reply });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error:'img failed', details:err.message });
  }
});

// helper
async function callAssistant(messages) {
  const resp = await fetch(API_URL, {
    method:'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
      'OpenAI-Beta':   'assistants=v2'
    },
    body: JSON.stringify({
      assistant_id: OPENAI_ASSISTANT_ID,
      messages,
      temperature: 0.7,
      max_tokens: 500
    })
  });
  if (!resp.ok) throw new Error(await resp.text());
  const { choices } = await resp.json();
  return choices[0].message.content;
}

// start
app.listen(PORT, () => console.log(`🚀 live on ${PORT}`));
