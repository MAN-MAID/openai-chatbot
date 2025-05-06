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

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/chat", async (req, res) => {
  try {
    const { message, fileUrl } = req.body;
    if (!message && !fileUrl) {
      return res.status(400).json({ error: "Need message or fileUrl." });
    }

    const tid = await ensureThread();

    // If there's a file, fetch and upload it to OpenAI files
    if (fileUrl) {
      console.log("Received fileUrl:", fileUrl);
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error("Failed to fetch file");
      const arrayBuffer = await resp.arrayBuffer();

      const up = await openai.files.create({
        file: Buffer.from(arrayBuffer),
        purpose: "vision"
      });
      console.log("Uploaded to OpenAI file ID:", up.id);

      await openai.beta.threads.messages.create(tid, {
        role:     "user",
        content:  "Here’s a file for you to analyse.",
        file_ids: [ up.id ]
      });
    }

    // If there's a text message, send it
    if (message) {
      console.log("Received message:", message);
      await openai.beta.threads.messages.create(tid, {
        role:    "user",
        content: message
      });
    }

    // Run the assistant
    const run = await openai.beta.threads.runs.create(tid, {
      assistant_id: assistantId
    });

    // Poll until the run is done
    let status;
    do {
      await new Promise(r => setTimeout(r, 1000));
      status = await openai.beta.threads.runs.retrieve(tid, run.id);
    } while (status.status !== "completed");

    // Fetch all messages and return the assistant’s latest
    const msgs  = await openai.beta.threads.messages.list(tid);
    const reply = msgs.data
      .filter(m => m.role === "assistant")
      .map(m => m.content[0].text.value)
      .join("\n\n");

    res.json({ reply });

  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`🚀 Listening on port ${port}`);
});
