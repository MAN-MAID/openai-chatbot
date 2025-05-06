import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import path from 'path';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

app.post('/chat', upload.single('file'), async (req, res) => {
  try {
    const userMessage = req.body.message || '';
    const filePath = req.file?.path;

    const form = new FormData();
    form.append('model', 'gpt-4o');
    form.append('messages', JSON.stringify([
      { role: 'system', content: 'You are a helpful assistant for a handyman business.' },
      { role: 'user', content: userMessage }
    ]));

    if (filePath) {
      const fileStream = fs.createReadStream(filePath);
      form.append('file', fileStream, path.basename(filePath));
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: form
    });

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content || 'Sorry, no response received.';

    if (filePath) fs.unlinkSync(filePath); // Cleanup

    res.json({ reply });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ reply: 'Server error occurred.' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
