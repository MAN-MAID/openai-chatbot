const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = '/tmp/uploads';

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

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

// Static file serving for uploaded images
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const reply = data.choices[0].message.content;

    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat request', details: error.message });
  }
});

// Image analysis
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  console.log('Image analysis request', { imageUrl: !!imageUrl, imageBase64: !!imageBase64, message });

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Either imageUrl or imageBase64 is required' });
  }

  try {
    let finalImageUrl;

    // If base64 is provided, save and host it
    if (imageBase64) {
      const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const filename = `${Date.now()}.jpg`;
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const serverUrl = process.env.SERVER_URL || `https://openai-chatbot-513z.onrender.com`;
      finalImageUrl = `${serverUrl}/uploads/${filename}`;

      console.log('Saved and served base64 image as:', finalImageUrl);
    }

    // If image URL is provided
    else if (imageUrl) {
      try {
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'image/*',
            'Referer': 'https://www.man-maid.co.uk'
          }
        });

        if (!imageResponse.ok) throw new Error('Image URL fetch failed');

        const buffer = await imageResponse.buffer();
        const filename = `${Date.now()}.jpg`;
        const filePath = path.join(UPLOAD_DIR, filename);
        fs.writeFileSync(filePath, buffer);

        const serverUrl = process.env.SERVER_URL || `https://openai-chatbot-513z.onrender.com`;
        finalImageUrl = `${serverUrl}/uploads/${filename}`;

        console.log('Fetched and saved image URL as:', finalImageUrl);
      } catch (err) {
        return res.status(400).json({ error: 'Could not fetch image URL', details: err.message });
      }
    }

    // Call OpenAI Vision API
    const visionResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: message || 'What do you see in this image?' },
              { type: 'image_url', image_url: { url: finalImageUrl, detail: 'high' } }
            ]
          }
        ],
        max_tokens: 500
      })
    });

    if (!visionResponse.ok) throw new Error(await visionResponse.text());

    const visionData = await visionResponse.json();
    const reply = visionData.choices[0].message.content;

    res.json({ reply });
  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({ error: 'Image analysis failed', details: error.message });
  }
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
  console.log(`🔗 Hosted image uploads at /uploads`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY is missing!');
  }
});
