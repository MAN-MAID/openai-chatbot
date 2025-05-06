const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ reply: "Missing message in request." });
    }

    // Create a new thread
    const thread = await openai.beta.threads.create();

    // Add user message
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // Run assistant on that thread
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.ASSISTANT_ID,
    });

    // Wait for the run to complete
    let runStatus;
    do {
      await new Promise((r) => setTimeout(r, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    } while (runStatus.status !== "completed");

    // Retrieve the final response
    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessage = messages.data.find((msg) => msg.role === "assistant");

    res.json({ reply: lastMessage.content[0].text.value });

  } catch (error) {
    console.error("Error in /chat:", error);
    res.status(500).json({ reply: "An error occurred while processing your message." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
