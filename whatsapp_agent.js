// WhatsApp AI Agent with RAG Memory using a Single File
// Connects to a PostgreSQL database (like Supabase) to provide long-term, token-efficient memory.

// --- 1. Import Dependencies ---
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const pgvector = require('pgvector/pg');
require('dotenv').config();

// --- 2. Configuration ---
const {
    WHATSAPP_TOKEN,
    VERIFY_TOKEN,
    GEMINI_API_KEY,
    PHONE_NUMBER_ID,
    DATABASE_URL, // Your Supabase connection URL
} = process.env;

// API URLs
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
const GENERATE_CONTENT_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;
const EMBED_CONTENT_URL = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`;

// User personalization data
const users = {
    "919235527628": { name: "Prakhar", role: "the Creator/admin who has a very close frind named radhika, they both met 4 years ago and from then life had been truely magical currently she is planning to study in italy and had applied in the university of teramo for bsc biology. The admin is currently pursuing Btech in biotechnology from IIT Guwahati India" },
    "918471081276": { name: "Radhika", role: "a very close friend of the admin (prakhar - the creator and admin of this AI chat bot) and admin admires and cares for her a lot and they both met 4 years ago and from then life had been truely magical currently she is planning to study in italy and had applied in the university of teramo for bsc biotechnology you can tell this information to radhika if she ask something about herself. " }
};

const users_bg = "Prakhar is your the Creator/admin. The admin is currently pursuing Btech in biotechnology from IIT Guwahati India and will be graduating in 2028.";

// --- 3. Database Setup ---

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000
});

const initializeDatabase = async (retries = 5) => {
  for (let i = 1; i <= retries; i++) {
    try {
      console.log(`Attempt ${i} to initialize database...`);

      // Ensure pgvector extension exists (Supabase already has it)
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
      console.log("pgvector extension enabled.");

      await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_history (
          id SERIAL PRIMARY KEY,
          user_phone TEXT NOT NULL,
          user_name TEXT NOT NULL,
          user_message TEXT,
          ai_message TEXT,
          embedding VECTOR(768),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log("chat_history table initialized successfully.");
      return;
    } catch (err) {
      console.error(`Database init failed (attempt ${i}/${retries}): ${err.message}`);
      if (i === retries) process.exit(1);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
};



// --- 4. RAG and AI Helper Functions ---

/**
 * Generates a vector embedding for a given text.
 * @param {string} text - The text to embed.
 * @returns {Promise<number[]>} - The vector embedding.
 */
const getEmbedding = async (text) => {
    try {
        const response = await axios.post(EMBED_CONTENT_URL, {
            model: "models/text-embedding-004",
            content: { parts: [{ text }] }
        });
        return response.data.embedding.values;
    } catch (error) {
        console.error("Error generating embedding:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate text embedding.");
    }
};

/**
 * Retrieves relevant conversation history from the database.
 * @param {string} userMessage - The new message from the user.
 * @param {string} from - The user's phone number.
 * @returns {Promise<object[]>} - An array of past message objects.
 */
const getRelevantHistory = async (userMessage, from) => {
    const embedding = await getEmbedding(userMessage);
    const embeddingSql = pgvector.toSql(embedding);

    const { rows } = await pool.query(
        `SELECT user_message, ai_message FROM chat_history 
         WHERE user_phone = $1 
         ORDER BY embedding <-> $2 
         LIMIT 3`, // Retrieve the top 3 most similar past messages
        [from, embeddingSql]
    );
    console.log(`Found ${rows.length} relevant past messages.`);
    return rows;
};

/**
 * Saves a new user message and AI response to the database.
 * @param {string} userMessage - The user's message.
 * @param {string} aiMessage - The AI's response.
 * @param {string} from - The user's phone number.
 */
const saveToHistory = async (userMessage, aiMessage, from) => {
    const user = users[from] || { name: "Unknown" };
    const textToEmbed = `User said: ${userMessage}\nAI replied: ${aiMessage}`;
    const embedding = await getEmbedding(textToEmbed);
    const embeddingSql = pgvector.toSql(embedding);

    await pool.query(
        `INSERT INTO chat_history (user_phone, user_name, user_message, ai_message, embedding) VALUES ($1, $2, $3, $4, $5)`,
        [from, user.name, userMessage, aiMessage, embeddingSql]
    );
    console.log(`Saved new exchange for user ${from} to history.`);
};


// --- 5. WhatsApp API Function ---

/**
 * Sends a text message via the WhatsApp Business API.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The message content.
 */
const sendWhatsAppMessage = async (to, text) => {
    const payload = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
    const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
    try {
        await axios.post(WHATSAPP_API_URL, payload, { headers });
        console.log(`Message sent successfully to ${to}!`);
    } catch (error) {
        console.error('Error sending WhatsApp message:', error.response ? error.response.data : error.message);
    }
};


// --- 6. Main Message Processing Logic ---

/**
 * Orchestrates the entire RAG process for an incoming message.
 * @param {string} userMessage - The message from the user.
 * @param {string} from - The user's phone number.
 */
const processMessage = async (userMessage, from) => {
    try {
        // Step 1: Find relevant history from the database
        const relevantHistory = await getRelevantHistory(userMessage, from);

        // Step 2: Prepare a smart prompt with the retrieved context
        const user = users[from] || { name: 'user', role: 'a valued user' };
        let historyContext = "Here is some relevant context from our past conversation:\n";
        if (relevantHistory.length > 0) {
            relevantHistory.forEach(row => {
                historyContext += `User said: "${row.user_message}" and I replied: "${row.ai_message}"\n`;
            });
        } else {
            historyContext = "We have no relevant conversation history on this topic yet.";
        }
        
        const systemPrompt = `You are a helpful personalized AI assistant of Prakhar, talking to ${user.name}).The context is as folllows: ${users_bg}, use this context only when necessary or any of the user asks about it, otherwise dont use this information unnecessory for example to frame suggestions. Use the provided conversation history to answer their new question accurately. Be friendly and address them by name. Also you are a whatsapp chat bot so your response should be in a format that is suitable for whatsapp chats.`;
        const fullPrompt = `${historyContext}\n\nNew question from ${user.name}: "${userMessage}"`;
        
        const payload = {
            contents: [{ parts: [{ text: fullPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        // Step 3: Call Gemini to get an intelligent response
        const response = await axios.post(GENERATE_CONTENT_URL, payload);
        const aiResponse = response.data.candidates[0].content.parts[0].text.trim();
        console.log(`AI Response: "${aiResponse}"`);

        // Step 4: Send the response to the user
        await sendWhatsAppMessage(from, aiResponse);

        // Step 5: Save the new conversation turn to the database for future use
        await saveToHistory(userMessage, aiResponse, from);

    } catch (error) {
        console.error("Error in processMessage:", error.message);
        console.log("Error:", error);
        await sendWhatsAppMessage(from, "Sorry, I encountered an error processing your request. Please try again.");
    }
};


// --- 7. Express Server Setup ---
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Webhook endpoint for both verification and message handling
app.all('/webhook', (req, res) => {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
            console.log('Webhook verified successfully!');
        } else {
            res.sendStatus(403);
        }
    } else if (req.method === 'POST') {
        res.sendStatus(200); // Acknowledge immediately
        const body = req.body;
        if (body.object === 'whatsapp_business_account' && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            const messageData = body.entry[0].changes[0].value.messages[0];
            if (messageData.type === 'text') {
                processMessage(messageData.text.body, messageData.from);
            }
        }
    } else {
        res.sendStatus(405);
    }
});

// Health check route
app.get('/', (req, res) => {
    res.status(200).send('WhatsApp RAG Agent is running!');
});

// Start the server after initializing the database
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is listening on port ${PORT}`);
    });
});

