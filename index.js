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
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors({
  origin: [
    'https://www.man-maid.co.uk',
    'https://www.man-maid.co.uk.filesusr.com'
  ],
  methods: ['GET', 'POST'],
  credentials: false
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'OpenAI Assistant API is running',
    endpoints: {
      imageAnalysis: '/analyze-wix-image'
    }
  });
});

app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.post('/analyze-wix-image', async (req, res) => {
  const { imageBase64, imageUrl, message } = req.body;
  let finalImageUrl;

  try {
    if (!OPENAI_ASSISTANT_ID) {
      throw new Error('OPENAI_ASSISTANT_ID is not set in the environment variables.');
    }

    if (imageBase64) {
      const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const filename = `${Date.now()}.jpg`;
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      finalImageUrl = `${SERVER_URL}/uploads/${filename}`;
    } else if (imageUrl) {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error('Failed to fetch image URL');
      const buffer = await imageResponse.buffer();
      const filename = `${Date.now()}.jpg`;
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      finalImageUrl = `${SERVER_URL}/uploads/${filename}`;
    } else {
      return res.status(400).json({ error: 'Image is required.' });
    }

    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const thread = await threadRes.json();

    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'user',
        content: [
          { type: 'text', text: message || 'What do you see in this image?' },
          { type: 'image_url', image_url: { url: finalImageUrl, detail: 'high' } }
        ]
      })
    });

    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
    });
    const run = await runRes.json();

    let runStatus = run.status;
    while (runStatus !== 'completed' && runStatus !== 'failed') {
      await new Promise(r => setTimeout(r, 1500));
      const pollRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
      });
      const pollData = await pollRes.json();
      runStatus = pollData.status;
    }

    const messagesRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });
    const messages = await messagesRes.json();
    const lastMessage = messages.data.find(m => m.role === 'assistant');

    res.json({ reply: lastMessage?.content[0]?.text?.value || 'No reply received.' });
  } catch (error) {
    console.error('Assistant error:', error);
    res.status(500).json({ error: 'Failed to analyze image', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!OPENAI_API_KEY) console.warn('⚠️ Missing OPENAI_API_KEY');
  if (!OPENAI_ASSISTANT_ID) console.warn('⚠️ Missing OPENAI_ASSISTANT_ID');
});
