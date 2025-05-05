const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

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
    // Step 1: Create a thread
    const threadResponse = await axios.post(
      'https://api.openai.com/v1/threads',
      {},
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2',
          'Content-Type': 'application/json'
        }
      }
    );

    const threadId = threadResponse.data.id;

    // Step 2: Add message to the thread
    await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        role: 'user',
        content: message
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2',
          'Content-Type': 'application/json'
        }
      }
    );

    // Step 3: Run the assistant
    const runResponse = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        assistant_id: process.env.ASSISTANT_ID  // Make sure this env var is set
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2',
          'Content-Type': 'application/json'
        }
      }
    );

    const runId = runResponse.data.id;

    // Step 4: Wait for the run to complete (polling loop)
    let runStatus = 'in_progress';
    let runResult;

    while (runStatus === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1500));

      const statusCheck = await axios.get(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2',
            'Content-Type': 'application/json'
          }
        }
      );

      runStatus = statusCheck.data.status;
      runResult = statusCheck.data;
    }

    // Step 5: Get the assistant's reply
    const messagesRes = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2',
          'Content-Type': 'application/json'
        }
      }
    );

    const assistantReply = messagesRes.data.data.find(msg => msg.role === 'assistant');

    res.json({ reply: assistantReply?.content[0]?.text?.value || 'No response from assistant.' });

  } catch (error) {
    console.error('Error using assistant API:', error.response?.data || error.message);
    res.status(500).send('Assistant API error');
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
