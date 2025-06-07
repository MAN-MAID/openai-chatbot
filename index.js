const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// OpenAI API configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'OpenAI Chatbot API is running',
    endpoints: {
      chat: '/chat',
      imageAnalysis: '/analyze-wix-image'
    }
  });
});

// Regular chat endpoint (no images)
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

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
          {
            role: 'system',
            content: 'You are a helpful assistant.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    
    res.json({ reply });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message 
    });
  }
});

// Image analysis endpoint for Wix
app.post('/analyze-wix-image', async (req, res) => {
  const { imageUrl, imageBase64, message } = req.body;
  
  console.log('Received image analysis request');
  console.log('Has imageUrl:', !!imageUrl);
  console.log('Has imageBase64:', !!imageBase64);
  console.log('Message:', message);

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Either imageUrl or imageBase64 is required' });
  }

  try {
    let imageData;
    
    // If base64 is provided, use it directly
    if (imageBase64) {
      console.log('Using provided base64 image');
      imageData = imageBase64;
    } 
    // Otherwise, try to fetch from URL
    else if (imageUrl) {
      console.log('Attempting to fetch image from URL:', imageUrl);
      
      try {
        // Try to fetch the image with proper headers
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/*',
            'Referer': 'https://www.man-maid.co.uk'
          }
        });
        
        if (!imageResponse.ok) {
          console.error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
          throw new Error(`Failed to fetch image: ${imageResponse.status}`);
        }
        
        const buffer = await imageResponse.buffer();
        const base64 = buffer.toString('base64');
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        
        console.log('Successfully fetched and converted image');
        console.log('Content type:', contentType);
        console.log('Buffer size:', buffer.length);
        
        imageData = `data:${contentType};base64,${base64}`;
        
      } catch (fetchError) {
        console.error('Failed to fetch image from URL:', fetchError);
        
        // Try alternative approach - direct HTTP access
        if (imageUrl.includes('wixstatic.com')) {
          console.log('Trying alternative URL format for Wix image');
          
          // Extract the media ID and try a simpler URL
          const mediaIdMatch = imageUrl.match(/\/media\/([^\/]+)/);
          if (mediaIdMatch) {
            const mediaId = mediaIdMatch[1];
            const alternativeUrl = `https://static.wixstatic.com/media/${mediaId}`;
            
            try {
              const altResponse = await fetch(alternativeUrl);
              if (altResponse.ok) {
                const buffer = await altResponse.buffer();
                const base64 = buffer.toString('base64');
                imageData = `data:image/jpeg;base64,${base64}`;
                console.log('Alternative URL worked!');
              }
            } catch (altError) {
              console.error('Alternative URL also failed:', altError);
            }
          }
        }
        
        if (!imageData) {
          return res.status(400).json({ 
            error: 'Could not access image from any URL pattern. Please ensure the image is publicly accessible or use base64 encoding.',
            attempted_url: imageUrl
          });
        }
      }
    }
    
    // Ensure imageData is properly formatted
    if (!imageData.startsWith('data:')) {
      imageData = `data:image/jpeg;base64,${imageData}`;
    }
    
    console.log('Sending request to OpenAI Vision API');
    
    // Call OpenAI Vision API
    const openAIResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: message || "What do you see in this image?"
              },
              {
                type: "image_url",
                image_url: {
                  url: imageData,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 500
      })
    });
    
    if (!openAIResponse.ok) {
      const errorText = await openAIResponse.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${openAIResponse.status}`);
    }
    
    const result = await openAIResponse.json();
    const reply = result.choices[0].message.content;
    
    console.log('Successfully analyzed image');
    res.json({ reply });
    
  } catch (error) {
    console.error('Error in analyze-wix-image:', error);
    res.status(500).json({ 
      error: 'Failed to analyze image',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 OpenAI API Key: ${OPENAI_API_KEY ? 'Set' : 'Not set'}`);
  
  if (!OPENAI_API_KEY) {
    console.error('⚠️  WARNING: OPENAI_API_KEY is not set in environment variables');
  }
});
