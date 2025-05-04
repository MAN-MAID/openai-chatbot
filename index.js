const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require ('axios');

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['POST']
}));
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { message } = req.body;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: message }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const reply = response?.data?.choices?.[0]?.message?.content || "No reply received.";
    res.json({ reply });

  } catch (error) {
    console.error('Error from OpenAI:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error calling OpenAI' });

  }
});

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
