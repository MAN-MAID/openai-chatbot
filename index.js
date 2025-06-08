// Thread creation
const threadRes = await fetch('https://api.openai.com/v1/threads', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2' // Add this
  }
});

// Message creation
await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2' // Add this
  },
  body: JSON.stringify({
    role: 'user',
    content: [
      { type: 'text', text: message || 'What do you see in this image?' },
      { type: 'image_url', image_url: { url: finalImageUrl, detail: 'high' } }
    ]
  })
});

// Run creation
const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2' // Add this
  },
  body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID })
});

// Run polling
const pollRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
  headers: { 
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'assistants=v2' // Add this
  }
});

// Messages retrieval
const messagesRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
  headers: { 
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'assistants=v2' // Add this
  }
});
