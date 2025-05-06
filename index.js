import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const assistantId = process.env.ASSISTANT_ID;
let threadId = null;

// Endpoint: Chat message handling
app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  try {
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      console.log("Created new thread:", threadId);
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    let runStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 1500));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    } while (runStatus.status !== "completed");

    const messages = await openai.beta.threads.messages.list(threadId);
    const reply = messages.data
      .filter(m => m.role === "assistant")
      .map(m => m.content[0].text.value)
      .join("\n");

    res.json({ reply });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Endpoint: File upload and attach
app.post("/upload", async (req, res) => {
  try {
    const { name, type, base64 } = req.body;

    if (!base64 || !type || !name) {
      return res.status(400).json({ error: "Invalid file input" });
    }

    const buffer = Buffer.from(base64, "base64");

    const uploadedFile = await openai.files.create({
      file: buffer,
      purpose: "assistants",
      name
    });

    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }

    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: "File uploaded for review.",
      file_ids: [uploadedFile.id],
    });

    res.json({ success: true, file_id: uploadedFile.id });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

app.get("/", (req, res) => {
  res.send("Assistant is live");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
