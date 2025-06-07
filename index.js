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
app.use(express.json({ limit: "100mb" })); // Increased limit for large base64 images
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// New endpoint to process Wix files
app.post("/process-wix-file", async (req, res) => {
  try {
    console.log("=== WIX FILE PROCESSING REQUEST ===");
    const { wixFileUrl, fileName, width, height } = req.body;
    console.log("Wix File URL:", wixFileUrl);
    console.log("File name:", fileName);
    console.log("Dimensions:", width, "x", height);
    
    if (!wixFileUrl || !fileName) {
      return res.status(400).json({ 
        success: false, 
        error: "Wix file URL and filename required" 
      });
    }
    
    // Try multiple approaches to get the image from Wix
    let imageBuffer = null;
    let mimeType = 'image/jpeg';
    
    // Approach 1: Try different Wix URL patterns
    const urlPatterns = [];
    
    if (wixFileUrl.startsWith('wix:image://')) {
      const wixPath = wixFileUrl.replace('wix:image://', '');
      
      // Try various URL formats that might work
      urlPatterns.push(
        `https://static.wixstatic.com/media/${wixPath}`,
        `https://images.wixmp.com/${wixPath}`,
        `https://www.wixstatic.com/media/${wixPath}`,
        // Try without the filename part
        `https://static.wixstatic.com/media/${wixPath.split('/')[0]}`,
        // Try with different subdomain
        `https://wixmp-${wixPath.split('/')[0].split('_')[0]}.wixmp.com/img/${wixPath}`
      );
    }
    
    console.log("Trying URL patterns:", urlPatterns.length);
    
    // Try each URL pattern
    for (const testUrl of urlPatterns) {
      try {
        console.log("Testing URL:", testUrl.substring(0, 100) + "...");
        
        const response = await fetch(testUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://www.wix.com/',
            'Origin': 'https://www.wix.com',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          timeout: 10000
        });
        
        console.log("Response status:", response.status, "Content-Type:", response.headers.get('content-type'));
        
        if (response.ok) {
          imageBuffer = await response.arrayBuffer();
          mimeType = response.headers.get('content-type') || 'image/jpeg';
          console.log("✅ Successfully fetched image, size:", imageBuffer.byteLength, "bytes");
          break;
        }
      } catch (fetchError) {
        console.log("❌ Failed:", fetchError.message);
      }
    }
    
    // If we got image data, convert to base64
    if (imageBuffer && imageBuffer.byteLength > 0) {
      const base64 = Buffer.from(imageBuffer).toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;
      
      console.log("✅ Successfully converted to base64, total length:", dataUrl.length);
      
      return res.json({
        success: true,
        base64Data: dataUrl,
        fileName: fileName,
        mimeType: mimeType,
        size: imageBuffer.byteLength
      });
    } else {
      console.log("❌ Could not fetch image from any URL pattern");
      
      return res.json({
        success: false,
        error: "Could not access image from Wix URL. The image may not be publicly accessible.",
        suggestion: "Try uploading the image to a public image hosting service like imgur.com and provide the direct image URL instead."
      });
    }
    
  } catch (error) {
    console.error("=== WIX FILE PROCESSING ERROR ===");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// New endpoint to process image URLs (like imgur)
app.post("/process-image-url", async (req, res) => {
  try {
    console.log("=== IMAGE URL PROCESSING REQUEST ===");
    const { imageUrl } = req.body;
    console.log("Image URL:", imageUrl);
    
    if (!imageUrl) {
      return res.status(400).json({ 
        success: false, 
        error: "Image URL required" 
      });
    }
    
    // Fetch the image from the URL
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8'
      },
      timeout: 15000
    });
    
    console.log("Response status:", response.status, "Content-Type:", response.headers.get('content-type'));
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const imageBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    
    console.log("✅ Successfully fetched image, size:", imageBuffer.byteLength, "bytes");
    
    // Convert to base64
    const base64 = Buffer.from(imageBuffer).toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    console.log("✅ Successfully converted to base64, total length:", dataUrl.length);
    
    return res.json({
      success: true,
      base64Data: dataUrl,
      mimeType: mimeType,
      size: imageBuffer.byteLength
    });
    
  } catch (error) {
    console.error("=== IMAGE URL PROCESSING ERROR ===");
    console.error("Error:", error.message);
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper endpoint to fetch Wix images (legacy)
app.post("/fetch-wix-image", async (req, res) => {
  try {
    const { wixUrl, fileName } = req.body;
    console.log("=== WIX IMAGE FETCH REQUEST ===");
    console.log("Wix URL:", wixUrl);
    console.log("File name:", fileName);
    
    if (!wixUrl) {
      return res.status(400).json({ error: "Wix URL required" });
    }
    
    // Try multiple URL patterns for Wix media
    const urlPatterns = [];
    
    if (wixUrl.startsWith('wix:image://')) {
      const wixPath = wixUrl.replace('wix:image://', '');
      urlPatterns.push(
        `https://static.wixstatic.com/media/${wixPath}`,
        `https://images.wixmp.com/${wixPath}`,
        `https://www.wixstatic.com/media/${wixPath}`
      );
    }
    
    console.log("Trying URL patterns:", urlPatterns);
    
    for (const testUrl of urlPatterns) {
      try {
        console.log("Testing:", testUrl);
        const response = await fetch(testUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; OpenAI-ImageBot/1.0)',
            'Accept': 'image/*',
            'Referer': 'https://www.wix.com/'
          }
        });
        
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const base64Data = `data:image/jpeg;base64,${base64}`;
          
          console.log("✅ Successfully fetched image, size:", buffer.byteLength);
          
          return res.json({
            success: true,
            base64Data: base64Data,
            fileName: fileName,
            size: buffer.byteLength
          });
        } else {
          console.log("❌ Failed with status:", response.status);
        }
      } catch (fetchError) {
        console.log("❌ Fetch error:", fetchError.message);
      }
    }
    
    console.log("❌ All URL patterns failed");
    res.json({
      success: false,
      error: "Could not fetch image from Wix URL"
    });
    
  } catch (error) {
    console.error("=== WIX IMAGE FETCH ERROR ===");
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/chat", async (req, res) => {
  try {
    console.log("=== NEW CHAT REQUEST ===");
    const { message, fileData } = req.body;
    console.log("Message:", message || "(none)");
    console.log("FileData received:", fileData ? {
      name: fileData.name,
      type: fileData.type,
      hasData: !!fileData.data,
      hasWixFileUrl: !!fileData.wixFileUrl,
      fallbackMode: fileData.fallbackMode,
      dataLength: fileData.data ? fileData.data.length : 0
    } : "(none)");
    
    if (!message && !fileData) {
      return res.status(400).json({ error: "Need message or fileData." });
    }

    // Handle images - prioritize direct base64 data
    if (fileData && (fileData.type?.startsWith('image/') || fileData.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i))) {
      console.log("Processing image with Chat Completions API");
      
      try {
        let imageUrl;
        
        // Method 1: Direct base64 data (best case)
        if (fileData.data) {
          imageUrl = fileData.data;
          console.log("Using direct base64 data from frontend");
          
        // Method 2: Wix file URL (fallback)
        } else if (fileData.wixFileUrl) {
          console.log("Processing Wix file URL:", fileData.wixFileUrl);
          
          const wixUrl = fileData.wixFileUrl;
          let success = false;
          
          if (wixUrl.startsWith('wix:image://')) {
            const wixPath = wixUrl.replace('wix:image://', '');
            
            // Try multiple URL patterns that might work
            const urlPatterns = [
              `https://static.wixstatic.com/media/${wixPath}`,
              `https://images.wixmp.com/${wixPath}`,
              `https://www.wixstatic.com/media/${wixPath}`
            ];
            
            console.log("Trying URL patterns for Wix media...");
            
            for (const testUrl of urlPatterns) {
              try {
                console.log("Testing:", testUrl);
                const response = await fetch(testUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; OpenAI-Vision/1.0)',
                    'Accept': 'image/*',
                    'Referer': 'https://www.wix.com/'
                  }
                });
                
                if (response.ok) {
                  const buffer = await response.arrayBuffer();
                  const base64 = Buffer.from(buffer).toString('base64');
                  imageUrl = `data:${fileData.type || 'image/jpeg'};base64,${base64}`;
                  console.log("✅ Successfully fetched from:", testUrl);
                  success = true;
                  break;
                } else {
                  console.log("❌ Failed with status:", response.status);
                }
              } catch (fetchError) {
                console.log("❌ Fetch error:", fetchError.message);
              }
            }
            
            if (!success) {
              throw new Error("All Wix URL patterns failed - image may not be publicly accessible");
            }
          } else {
            throw new Error("Unsupported Wix URL format");
          }
        } else {
          throw new Error("No image data or URL provided");
        }
        
        // Send to OpenAI Vision API
        console.log("Sending to OpenAI Vision API...");
        const response = await openai.chat.completions.create({
          model: "gpt-4-vision-preview",
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
                    url: imageUrl
                  }
                }
              ]
            }
          ],
          max_tokens: 1000
        });
        
        const reply = response.choices[0].message.content;
        console.log("✅ Vision API response received, length:", reply.length);
        
        return res.json({ 
          reply: reply,
          method: "vision-api",
          imageProcessed: true
        });
        
      } catch (visionError) {
        console.error("❌ Vision API error:", visionError.message);
        // Don't fall back to assistant - return the error so user knows what happened
        return res.status(400).json({ 
          error: `Image processing failed: ${visionError.message}`,
          suggestion: "Try uploading a different image or send a text message."
        });
      }
    }

    // Original assistant method for non-images or as fallback
    const tid = await ensureThread();

    // Handle non-image files or fallback
    if (fileData && !fileData.type?.startsWith('image/')) {
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
    console.error("=== CHAT ERROR ===");
    console.error("Error type:", err.constructor.name);
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    console.error("===================");
    
    res.status(500).json({ 
      error: err.message,
      type: err.constructor.name,
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
  console.log(`📸 Image processing endpoints: /process-wix-file, /process-image-url`);
});
