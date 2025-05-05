import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  const assistantId = process.env.ASSISTANT_ID;

  try {
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    let runStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    } while (runStatus.status !== "completed");

    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessage = messages.data.find(msg => msg.role === "assistant");

    const textResponse = lastMessage?.content?.[0]?.text?.value || "Sorry, no reply.";

    res.json({ reply: textResponse });

  } catch (error) {
    console.error("Error in /chat:", error.message || error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
