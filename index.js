// index.js
import express from "express";
import cors   from "cors";
import dotenv from "dotenv";
import fetch  from "node-fetch";     // npm install node-fetch
import { OpenAI } from "openai";     // npm install openai

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const openai      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = process.env.ASSISTANT_ID;
let   threadId    = null;

// ensure we only create one thread per server run
async function ensureThread() {
  if (!threadId) {
    console.log("▶️ Creating new thread…");
    const t = await openai.beta.threads.create();
    threadId = t.id;
    console.log("🔖 Thread ID:", threadId);
  }
  return threadId;
}

app.post("/chat", async (req, res) => {
  try {
    console.log("📬 /chat body:", req.body);
    const { message, fileUrl } = req.body;

    if (!message && !fileUrl) {
      return res.status(400).json({ error: "Need at least message or fileUrl." });
    }
    if (fileUrl) console.log("🔗 Received fileUrl:", fileUrl);

    const tid = await ensureThread();

    // 1️⃣ If there's a file URL, fetch it & upload to OpenAI
    if (fileUrl) {
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
      const buffer = await resp.arrayBuffer();

      console.log("📤 Uploading file to OpenAI…");
      const up = await openai.files.create({
        file: Buffer.from(buffer),
        purpose: "vision"
      });
      console.log("✅ Uploaded file ID:", up.id);

      // Tell the thread about the new file
      await openai.beta.threads.messages.create(tid, {
        role:    "user",
        content: "Here’s a file for you to analyse.",
        file_ids: [ up.id ],
      });
    }

    // 2️⃣ Send any plain‐text user message
    if (message) {
      console.log("✉️ Sending user message to thread:", message);
      await openai.beta.threads.messages.create(tid, {
        role:    "user",
        content: message
      });
    }

    // 3️⃣ Run the assistant
    console.log("▶️ Running assistant…");
    const run = await openai.beta.threads.runs.create(tid, {
      assistant_id: assistantId
    });

    // 4️⃣ Poll until the run is done
    let status;
    do {
      await new Promise(r => setTimeout(r, 1000));
      status = await openai.beta.threads.runs.retrieve(tid, run.id);
      console.log("… status:", status.status);
    } while (status.status !== "completed");

    // 5️⃣ Grab all messages & return the assistant’s last one
    const msgs  = await openai.beta.threads.messages.list(tid);
    const reply = msgs.data
      .filter(m => m.role === "assistant")
      .map(m => m.content[0].text.value)
      .join("\n\n");
    console.log("🤖 Assistant reply:", reply);

    res.json({ reply });

  } catch (err) {
    console.error("❌ Error in /chat:", err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
