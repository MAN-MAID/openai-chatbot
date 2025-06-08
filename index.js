const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads'); // Better for deployment

// Environment variables with fallback handling
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_Key || '';
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || process.env.OPENAI_ASSISTANT_Id || '';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Log environment variable status for debugging
console.log('🔍 Environment Check:');
console.log('- OPENAI_API_KEY length:', OPENAI_API_KEY ? OPENAI_API_KEY.length : 0);
console.log('- OPENAI_ASSISTANT_ID length:', OPENAI_ASSISTANT_ID ? OPENAI_ASSISTANT_ID.length : 0);
console.log('- SERVER_URL:', SERVER_URL);

// Create upload directory if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// CORS configuration - Allow all origins for debugging
const corsOptions = {
  origin: true, // Allow all origins for now
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  optionsSuccessStatus: 200
};

// Handle preflight requests
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Additional CORS headers middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'OpenAI Assistant API is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      imageAnalysis: '/analyze-wix-image',
      uploads: '/uploads/:filename'
    }
  });
});

// Serve uploaded images with CORS headers
app.get('/uploads/:filename', (req, res) => {
  try {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    
    if (fs.existsSync(filePath)) {
      // Enhanced CORS headers for image serving
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'image/jpeg'
      });
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Main image analysis endpoint
app.post('/analyze-wix-image', async (req, res) => {
  const { imageBase64, imageUrl, message } = req.body;
  let finalImageUrl;
  let tempFilePath;

  try {
    console.log('🔍 Request received:', { 
      hasImageBase64: !!imageBase64, 
      hasImageUrl: !!imageUrl,
      message: message || 'No message provided'
    });

    // Validate environment variables
    if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === '') {
      console.error('❌ OPENAI_API_KEY is missing or empty');
      return res.status(500).json({ 
        error: 'Server configuration error: OPENAI_API_KEY not configured',
        details: 'Please check environment variables'
      });
    }
    if (!OPENAI_ASSISTANT_ID || OPENAI_ASSISTANT_ID.trim() === '') {
      console.error('❌ OPENAI_ASSISTANT_ID is missing or empty');
      return res.status(500).json({ 
        error: 'Server configuration error: OPENAI_ASSISTANT_ID not configured',
        details: 'Please check environment variables'
      });
    }

    // Process image - either base64 or URL
    if (imageBase64) {
      console.log('📷 Processing base64 image...');
      const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const filename = `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      tempFilePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(tempFilePath, buffer);
      finalImageUrl = `${SERVER_URL}/uploads/${filename}`;
    } else if (imageUrl) {
      console.log('🌐 Processing image URL:', imageUrl);
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image from URL: ${imageResponse.status} ${imageResponse.statusText}`);
      }
      const buffer = await imageResponse.buffer();
      const filename = `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      tempFilePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(tempFilePath, buffer);
      finalImageUrl = `${SERVER_URL}/uploads/${filename}`;
    } else {
      return res.status(400).json({ error: 'Either imageBase64 or imageUrl is required' });
    }

    console.log('✅ Image processed. Final URL:', finalImageUrl);

    // Test if the image URL is accessible
    try {
      const testResponse = await fetch(finalImageUrl);
      if (!testResponse.ok) {
        throw new Error(`Image URL not accessible: ${testResponse.status}`);
      }
      console.log('✅ Image URL is accessible');
    } catch (urlError) {
      console.error('❌ Image URL accessibility test failed:', urlError.message);
      throw new Error(`Image URL not accessible: ${urlError.message}`);
    }

    // Create OpenAI thread
    console.log('🧵 Creating OpenAI thread...');
    const threadRes = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!threadRes.ok) {
      const errorText = await threadRes.text();
      throw new Error(`Failed to create thread: ${threadRes.status} - ${errorText}`);
    }

    const thread = await threadRes.json();
    console.log('✅ Thread created:', thread.id);

    // Add message to thread
    console.log('💬 Adding message to thread...');
    const messageRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: [
          { 
            type: 'text', 
            text: message || 'What do you see in this image? Please analyze it in detail.' 
          },
          { 
            type: 'image_url', 
            image_url: { 
              url: finalImageUrl, 
              detail: 'high' 
            } 
          }
        ]
      })
    });

    if (!messageRes.ok) {
      const errorText = await messageRes.text();
      throw new Error(`Failed to add message: ${messageRes.status} - ${errorText}`);
    }

    console.log('✅ Message added to thread');

    // Create run
    console.log('🏃 Creating run with assistant...');
    const runRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({ 
        assistant_id: OPENAI_ASSISTANT_ID 
      })
    });

    if (!runRes.ok) {
      const errorText = await runRes.text();
      throw new Error(`Failed to create run: ${runRes.status} - ${errorText}`);
    }

    const run = await runRes.json();
    console.log('✅ Run created:', run.id);

    // Poll for completion
    console.log('⏳ Polling for completion...');
    let runStatus = run.status;
    let attempts = 0;
    const maxAttempts = 60; // 90 seconds max (1.5 seconds * 60)

    while (runStatus !== 'completed' && runStatus !== 'failed' && runStatus !== 'cancelled' && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const pollRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: { 
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      if (!pollRes.ok) {
        console.error('❌ Polling failed:', pollRes.status);
        break;
      }

      const pollData = await pollRes.json();
      runStatus = pollData.status;
      console.log(`📊 Run status: ${runStatus} (attempt ${attempts}/${maxAttempts})`);

      if (runStatus === 'failed') {
        console.error('❌ Run failed:', pollData.last_error);
        throw new Error(`Assistant run failed: ${pollData.last_error?.message || 'Unknown error'}`);
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error('Assistant response timeout - please try again');
    }

    if (runStatus !== 'completed') {
      throw new Error(`Assistant run ended with status: ${runStatus}`);
    }

    console.log('✅ Run completed successfully');

    // Get messages
    console.log('📨 Retrieving messages...');
    const messagesRes = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: { 
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!messagesRes.ok) {
      const errorText = await messagesRes.text();
      throw new Error(`Failed to retrieve messages: ${messagesRes.status} - ${errorText}`);
    }

    const messages = await messagesRes.json();
    const assistantMessage = messages.data.find(m => m.role === 'assistant');

    if (!assistantMessage || !assistantMessage.content || !assistantMessage.content[0]) {
      throw new Error('No valid response received from assistant');
    }

    const reply = assistantMessage.content[0].text?.value || 'No reply content found';
    console.log('✅ Response received from assistant');

    // Clean up temp file after successful processing
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      setTimeout(() => {
        try {
          fs.unlinkSync(tempFilePath);
          console.log('🧹 Temporary file cleaned up:', tempFilePath);
        } catch (cleanupError) {
          console.warn('⚠️ Failed to cleanup temp file:', cleanupError.message);
        }
      }, 5000); // Delete after 5 seconds
    }

    res.json({ 
      success: true,
      reply: reply,
      imageUrl: finalImageUrl,
      threadId: thread.id
    });

  } catch (error) {
    console.error('❌ Assistant error:', error);
    
    // Clean up temp file on error
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('🧹 Temporary file cleaned up after error');
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup temp file after error:', cleanupError.message);
      }
    }

    res.status(500).json({ 
      success: false,
      error: 'Failed to analyze image', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Server URL: ${SERVER_URL}`);
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
  
  // Environment variable checks - don't crash the server
  if (!OPENAI_API_KEY || OPENAI_API_KEY.trim() === '') {
    console.warn('⚠️  OPENAI_API_KEY is missing - image analysis will not work');
  } else {
    console.log('✅ OPENAI_API_KEY is configured');
  }
  
  if (!OPENAI_ASSISTANT_ID || OPENAI_ASSISTANT_ID.trim() === '') {
    console.warn('⚠️  OPENAI_ASSISTANT_ID is missing - image analysis will not work');
  } else {
    console.log('✅ OPENAI_ASSISTANT_ID is configured');
  }
  
  console.log('🎯 Server started successfully!');
});
