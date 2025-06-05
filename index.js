// src/index.js
import express     from "express";
import cors        from "cors";
import dotenv      from "dotenv";
import { OpenAI }  from "openai";

dotenv.config();

const app          = express();
const port         = process.env.PORT || 3000;
const openai       = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId  = process.env.ASSISTANT_ID;
let   threadId     = null;

// Ensure we have a conversation thread open
async function ensureThread() {
  if (!threadId) {
    const t = await openai.beta.threads.create();
    threadId = t.id;
    console.log("Created thread:", threadId);
  }
  return threadId;
}

// Helper function to convert base64 to buffer
function base64ToBuffer(base64String) {
  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const base64Data = base64String.includes(',') 
    ? base64String.split(',')[1] 
    : base64String;
  
  return Buffer.from(base64Data, 'base64');
}

// Helper function to get file extension from MIME type
function getFileExtension(mimeType) {
  const mimeToExt = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
  };
  
  return mimeToExt[mimeType] || 'bin';
}

app.use(cors());
app.use(express.json({ limit: "50mb" })); // Increased limit for base64 files

app.post("/chat", async (req, res) => {
  try {
    const { message, fileData } = req.body;
    
    if (!message && !fileData) {
      return res.status(400).json({ error: "Need message or fileData." });
    }

    // Handle images differently - use Chat Completions API for better vision support
    if (fileData && fileData.type.startsWith('image/')) {
      console.log("Processing image with Chat Completions API");
      
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4-vision-preview", // or "gpt-4o" if available
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: message || "Please analyze this image and describe what you see in detail."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: fileData.data
                  }
                }
              ]
            }
          ],
          max_tokens: 1000
        });
        
        const reply = response.choices[0].message.content;
        console.log("Vision API response received");
        
        return res.json({ 
          reply: reply,
          method: "vision-api"
        });
        
      } catch (visionError) {
        console.error("Vision API error:", visionError);
        // Fall back to assistant method if vision API fails
      }
    }

    // Original assistant method for non-images or as fallback
    const tid = await ensureThread();

    // Handle non-image files or fallback
    if (fileData && !fileData.type.startsWith('image/')) {
      console.log("Processing non-image file with Assistant API");
      
      try {
        // For non-image files, upload to OpenAI files
        const fileBuffer = base64ToBuffer(fileData.data);
        const fileExtension = getFileExtension(fileData.type);
        const fileName = fileData.name || `file.${fileExtension}`;
        
        console.log("File size:", fileBuffer.length, "bytes");
        
        // Create a File-like object for OpenAI
        const fileBlob = new Blob([fileBuffer], { type: fileData.type });
        
        // Upload to OpenAI files
        const uploadedFile = await openai.files.create({
          file: new File([fileBlob], fileName, { type: fileData.type }),
          purpose: "assistants"
        });
        
        console.log("Uploaded to OpenAI file ID:", uploadedFile.id);
        
        // Add file message to thread
        await openai.beta.threads.messages.create(tid, {
          role: "user",
          content: "Here's a file for you to analyze.",
          attachments: [
            {
              file_id: uploadedFile.id,
              tools: [{ type: "file_search" }]
            }
          ]
        });
        
      } catch (fileError) {
        console.error("File processing error:", fileError);
        return res.status(400).json({ 
          error: `File processing failed: ${fileError.message}` 
        });
      }
    }

    // Handle text message
    if (message) {
      console.log("Received message:", message);
      await openai.beta.threads.messages.create(tid, {
        role: "user",
        content: message
      });
    }

    // Check what messages are in the thread before running
    const preRunMessages = await openai.beta.threads.messages.list(tid);
    console.log("Messages in thread before run:", preRunMessages.data.length);
    preRunMessages.data.forEach((msg, idx) => {
      console.log(`Message ${idx}:`, msg.role, msg.content.map(c => c.type));
    });

    // Run the assistant
    console.log("Starting assistant run...");
    const run = await openai.beta.threads.runs.create(tid, {
      assistant_id: assistantId
    });

    // Poll until the run is done with timeout
    let status;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds timeout
    
    do {
      await new Promise(r => setTimeout(r, 1000));
      status = await openai.beta.threads.runs.retrieve(tid, run.id);
      attempts++;
      
      console.log(`Run status: ${status.status} (attempt ${attempts})`);
      
      if (attempts >= maxAttempts) {
        throw new Error("Assistant run timed out");
      }
      
      // Handle failed runs
      if (status.status === "failed") {
        throw new Error(`Assistant run failed: ${status.last_error?.message || "Unknown error"}`);
      }
      
    } while (!["completed", "failed", "cancelled", "expired"].includes(status.status));

    if (status.status !== "completed") {
      throw new Error(`Assistant run ended with status: ${status.status}`);
    }

    // Fetch all messages and return the assistant's latest
    const msgs = await openai.beta.threads.messages.list(tid);
    const assistantMessages = msgs.data
      .filter(m => m.role === "assistant")
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (assistantMessages.length === 0) {
      throw new Error("No response from assistant");
    }

    // Get the latest assistant message
    const latestMessage = assistantMessages[0];
    const reply = latestMessage.content
      .filter(content => content.type === "text")
      .map(content => content.text.value)
      .join("\n\n");

    console.log("Assistant reply length:", reply.length);
    
    res.json({ 
      reply: reply || "I received your message but couldn't generate a response.",
      threadId: tid,
      runId: run.id,
      method: "assistant-api"
    });

  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ 
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    threadId: threadId || "none"
  });
});

// Reset thread endpoint (useful for testing)
app.post("/reset", async (req, res) => {
  try {
    threadId = null;
    res.json({ message: "Thread reset successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🤖 Assistant ID: ${assistantId ? 'Set' : 'Missing'}`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Set' : 'Missing'}`);
});
