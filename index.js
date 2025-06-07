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

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'OpenAI Chatbot API is running',
    endpoints: {
      chat: '/chat',
      imageAnalysis: '/analyze-wix-image'
    }
  });
});

// Static file serving
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Chat endpoint using your custom assistant
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    // 1. Create a new thread
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

    // 2. Post the user message
    const msgRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        ...ASSISTANTS_HEADER
      },
      body: JSON.stringify({
        role: 'user',
        content: message
      })
    });
    if (!msgRes.ok) throw new Error(await msgRes.text());

    // 3. Run the assistant
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
    const { id: run_id, status: initialStatus } = await runRes.json();

    // 4. Poll until finished
    let status = initialStatus;
    while (status === 'queued' || status === 'in_progress') {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/runs/${run_id}`, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          ...ASSISTANTS_HEADER
        }
      });
      if (!pollRes.ok) throw new Error(await pollRes.text());
      status = (await pollRes.json()).status;
    }

    // 5. Fetch all messages and return the assistant’s reply
    const allRes = await fetch(`${OPENAI_BASE}/threads/${thread_id}/messages`, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...ASSISTANTS_HEADER
      }
    });
    if (!allRes.ok) throw new Error(await allRes.text());
    const { data: msgs } = await allRes.json();
    const assistantMsg = msgs.reverse().find(m => m.role === 'assistant');

    res.json({ reply: assistantMsg?.content || '' });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat request', details: error.message });
  }
});

// (Your existing /analyze-wix-image handler stays unchanged)

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
  if (!OPENAI_API_KEY) console.warn('⚠️ OPENAI_API_KEY is missing!');
  if (!OPENAI_ASSISTANT_ID) console.warn('⚠️ OPENAI_ASSISTANT_ID is missing!');
});
