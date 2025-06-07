// index.js
const express = require('express');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    =('path');
require('dotenv').config();

// ─── CONFIG ─────────────────────────────────────────────────────
const app                 = express();
const PORT                = process.env.PORT || 10000;
const UPLOAD_DIR          = '/tmp/uploads';
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const ASSISTANT_ID        = process.env.OPENAI_ASSISTANT_ID;
const OPENAI_BASE         = 'https://api.openai.com/v1';

// ─── SETUP ──────────────────────────────────────────────────────
// CORS + JSON
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin',  req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit:'50mb' }));

// Ensure upload dir
if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ─── HELPERS ────────────────────────────────────────────────────
async function createThread() {
  const res = await fetch(`${OPENAI_BASE}/threads`, {
    method:'POST',
    headers:{
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
      'OpenAI-Beta':   'assistants=v2'
    },
    body: JSON.stringify({ assistant_id: ASSISTANT_ID })
  });
  if(!res.ok) throw new Error(await res.text());
  return (await res.json()).id;
}

async function postMessage(thread_id, role, content) {
  const res = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
    method:'POST',
    headers:{
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
      'OpenAI-Beta':   'assistants=v2'
    },
    body: JSON.stringify({ role, content })
  });
  if(!res.ok) throw new Error(await res.text());
}

async function runAssistant(thread_id) {
  const res = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs`, {
    method:'POST',
    headers:{
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
      'OpenAI-Beta':   'assistants=v2'
    }
  });
  if(!res.ok) throw new Error(await res.text());
  const { id, status } = await res.json();
  return { run_id: id, status };
}

async function pollUntilDone(thread_id, run_id) {
  let status = 'queued';
  while (['queued','in_progress'].includes(status)) {
    await new Promise(r => setTimeout(r, 1000));
    const res = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
      headers:{
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta':   'assistants=v2'
      }
    });
    if(!res.ok) throw new Error(await res.text());
    status = (await res.json()).status;
  }
}

async function fetchReply(thread_id) {
  const res = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages?limit=1`, {
    headers:{
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta':   'assistants=v2'
    }
  });
  if(!res.ok) throw new Error(await res.text());
  const msgs = await res.json();
  return msgs.data[0].content;
}

// Single helper to do the whole dance
async function askAssistant(messages=[]) {
  const thread = await createThread();
  for(const { role, content } of messages) {
    await postMessage(thread, role, content);
  }
  const { run_id, status } = await runAssistant(thread);
  await pollUntilDone(thread, run_id);
  return await fetchReply(thread);
}

// ─── ENDPOINTS ──────────────────────────────────────────────────
// Health-check
app.get('/',(_,res)=>res.json({status:'up', chat:'/chat', img:'/analyze-wix-image'}));

// Text-only chat
app.post('/chat', async (req,res)=>{
  const { message } = req.body;
  if(!message) return res.status(400).json({ error:'no message' });
  try {
    const reply = await askAssistant([{role:'user',content:message}]);
    res.json({ reply });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:'chat failed', details:e.message });
  }
});

// Image + chat
app.post('/analyze-wix-image', async (req,res)=>{
  const { imageUrl, imageBase64, message='' } = req.body;
  if(!imageUrl && !imageBase64) {
    return res.status(400).json({ error:'no image supplied' });
  }
  try {
    // host the image locally
    let publicUrl;
    if(imageBase64) {
      const data = imageBase64.split(',')[1];
      const buf  = Buffer.from(data,'base64');
      const fn   = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR,fn), buf);
      publicUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    } else {
      const r = await fetch(imageUrl);
      if(!r.ok) throw new Error('fetch failed');
      const buf = await r.buffer();
      const fn  = `${Date.now()}.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR,fn), buf);
      publicUrl = `${process.env.SERVER_URL}/uploads/${fn}`;
    }

    const msgs = [
      { role:'user', content: message || 'What do you see here?' },
      { role:'user', content:`<image>${publicUrl}</image>` }
    ];
    const reply = await askAssistant(msgs);
    res.json({ reply });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:'img failed', details:e.message });
  }
});

// Static serve uploads
app.get('/uploads/:f',(req,res)=>{
  const p = path.join(UPLOAD_DIR,req.params.f);
  fs.existsSync(p) ? res.sendFile(p) : res.sendStatus(404);
});

// Start
app.listen(PORT,()=>console.log(`🚀 live on ${PORT}`));
