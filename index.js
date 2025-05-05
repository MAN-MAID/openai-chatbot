const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const assistantId = process.env.OPENAI_ASSISTANT_ID;

app.post('/chat', async (req, res) => {
  const { message } = req.body;

  try {
    // Step 1: Create a new thread
    const thread = await axios.post(
      'https://api.openai.com/v1/threads',
      {},
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1',
          'Content-Type': 'application/json',
        },
      }
    );

    const threadId = thread.data.id;

    // Step 2: Add message to thread
    await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        role: 'user',
        content: message,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1',
          'Content-Type': 'application/json',
        },
      }
    );

    // Step 3: Run assistant
    const run = await axios.post(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        assistant_id: assistantId,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1',
          'Content-Type': 'application/json',
        },
      }
    );

    const runId = run.data.id;

    // Step 4: Poll until run is complete
    let status = 'in_progress';
    while (status !== 'completed' && status !== 'failed') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const runCheck = await axios.get(
        `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v1',
          },
        }
      );
      status = runCheck.data.status;
    }

    // Step 5: Get the reply
    const messages = await axios.get(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v1',
        },
      }
    );

  const assistantReply = messages.data.data.find(
    (msg) => msg.role === 'assistant'
  );

  let reply = 'No reply found.';
  if (assistantReply && assistantReply.content.length > 0) {
  const textPart = assistantReply.content.find(
    (c) => c.type === 'text' && c.text?.value
  );
  if (textPart) {
    reply = textPart.text.value;
  }
}
console.log('Assistant said:', reply);


    res.json({ reply: reply || 'No reply found.' });
  } catch (error) {
    console.error('Assistant API Error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to communicate with Assistant',
      detail: error.response?.data || error.message,
    });
  }
});

app.get('/', (req, res) => {
  res.send('Assistant server is live.');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
