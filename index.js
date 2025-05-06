import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());

app.post('/chat', upload.single('file'), async (req, res) => {
  try {
    const userMessage = req.body.message || '';

    let fileContent = '';
    if (req.file) {
      const buffer = await readFile(req.file.path);
      fileContent = `\nUser uploaded file:\n${buffer.toString('base64').substring(0, 100)}...`; // short preview
    }

    if (!userMessage && !req.file) {
      return res.status(400).json({ reply: 'Missing message or file in request.' });
    }

    const prompt = `${userMessage}${fileContent}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are Mungo’s helpful assistant.' },
        { role: 'user', content: prompt },
      ],
    });

    const reply = completion.choices[0]?.message?.content || 'No reply generated.';
    res.json({ reply });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ reply: 'Server error. Please try again later.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
