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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ensure upload dir
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// health check
app.get('/', (req, res) => {
  res.json({ status: 'OpenAI Chatbot API running', endpoints: { chat:'/chat', image:'/analyze-wix-image' } });
});

// serve uploads
app.get('/uploads/:file', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.file);
  fs.existsSync(fp) ? res.sendFile(fp) : res.status(404).send('Not found');
});

// TEXT CHAT
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error:'Message is required' });

  try {
    // 1) create thread
    const thr = await fetch(`${OPENAI_BASE}/threads`, {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${OPENAI_API_KEY}`,
        'Content-Type':'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if(!thr.ok) throw new Error(await thr.text());
    const { id: thread_id } = await thr.json();

    // 2) post user
    const post = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method:'POST',
      headers: thr.headers,
      body: JSON.stringify({ role:'user', content:message })
    });
    if(!post.ok) throw new Error(await post.text());

    // 3) run assistant
    const run = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method:'POST',
      headers: thr.headers,
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if(!run.ok) throw new Error(await run.text());
    let { id: run_id, status } = await run.json();

    // 4) poll
    while(['queued','in_progress'].includes(status)) {
      await new Promise(r=>setTimeout(r,1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: thr.headers
      });
      if(!p.ok) throw new Error(await p.text());
      status = (await p.json()).status;
    }

    // 5) fetch reply
    const all = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: thr.headers
    });
    if(!all.ok) throw new Error(await all.text());
    const { data: msgs } = await all.json();
    const reply = msgs.reverse().find(m=>m.role==='assistant')?.content||'';
    res.json({ reply });

  } catch(err) {
    console.error('Chat error:', err);
    res.status(500).json({ error:'Chat failed', details:err.message });
  }
});

// IMAGE ANALYSIS
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  if (!imageUrl && !imageBase64) return res.status(400).json({ error:'Provide imageUrl or imageBase64' });

  try {
    // save image
    let finalUrl;
    if (imageBase64) {
      const buf = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/,''),'base64');
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR,fn),buf);
      finalUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    } else {
      const img = await fetch(imageUrl);
      if(!img.ok) throw new Error('Remote fetch failed');
      const buf = await img.buffer();
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR,fn),buf);
      finalUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    }

    // 1) create thread
    const thr = await fetch(`${OPENAI_BASE}/threads`, {
      method:'POST',
      headers:{
        'Authorization':`Bearer ${OPENAI_API_KEY}`,
        'Content-Type':'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if(!thr.ok) throw new Error(await thr.text());
    const { id: thread_id } = await thr.json();

    // 2) post user + image
    const post = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method:'POST',
      headers: thr.headers,
      body: JSON.stringify({
        role:'user',
        content:message||'',
        attachments:[{ type:'image_url', image_url:{ url:finalUrl, detail:'high' }}]
      })
    });
    if(!post.ok) throw new Error(await post.text());

    // 3) run assistant
    const run = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
      method:'POST',
      headers: thr.headers,
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    if(!run.ok) throw new Error(await run.text());
    let { id: run_id, status } = await run.json();

    // 4) poll
    while(['queued','in_progress'].includes(status)) {
      await new Promise(r=>setTimeout(r,1000));
      const p = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: thr.headers
      });
      if(!p.ok) throw new Error(await p.text());
      status = (await p.json()).status;
    }

    // 5) fetch reply
    const all = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: thr.headers
    });
    if(!all.ok) throw new Error(await all.text());
    const { data: msgs } = await all.json();
    const reply = msgs.reverse().find(m=>m.role==='assistant')?.content||'';
    res.json({ reply });

  } catch(err) {
    console.error('Image analysis error:', err);
    res.status(500).json({ error:'Image analysis failed', details:err.message });
  }
});

// error handler & start
app.use((e,req,res,next)=>{
  console.error('Unhandled error:',e);
  res.status(500).json({ error:'Internal error', details:e.message });
});
app.listen(PORT,()=>console.log(`🚀 Server on ${PORT}`));
