// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const assistantId = process.env.ASSISTANT_ID;
let threadId = null;

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: "Missing message in request." });
    }

    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }

    // send user message
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // run assistant
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });

    // poll until complete
    let status;
    do {
      await new Promise(r => setTimeout(r, 500));
      status = await openai.beta.threads.runs.retrieve(threadId, run.id);
    } while (status.status !== "completed");

    // collect reply
    const msgs = await openai.beta.threads.messages.list(threadId);
    const reply = msgs.data
      .filter(m => m.role === "assistant")
      .map(m => m.content[0].text.value)
      .join("\n");

    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error." });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Listening for chat…")
);
