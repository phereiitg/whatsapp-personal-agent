// WhatsApp AI Agent using Node.js, Express, and Gemini API
//
// This server listens for incoming WhatsApp messages via a webhook,
// sends the message content to the Gemini AI for a response,
// and then sends that response back to the user on WhatsApp.

// Import required packages
const express = require('express');
const axios = require('axios');
require('dotenv').config(); // To manage environment variables

// --- Configuration ---
// Load variables from the .env file or Replit Secrets
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// --- NEW: User Personalization Database ---
// A simple object to map phone numbers to user data.
// Replace these with the actual WhatsApp numbers (including country code, no + or spaces).
const users = {
    "919235527628": { name: "Prakhar", role: "the Creator/Admin" },
    "918471081276": { name: "Radhika", role: "Girlfriend of the creator" }
    // Add more users here
};


// Initialize Express app
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

const PORT = process.env.PORT || 3000;

// --- Main Webhook Endpoint ---
app.all('/webhook', (req, res) => {
    if (req.method === 'GET') {
        // --- Webhook Verification (GET Request) ---
        // (This part is unchanged)
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('Webhook verified successfully!');
                res.status(200).send(challenge);
            } else {
                res.sendStatus(403);
            }
        } else {
            res.sendStatus(400);
        }
    } else if (req.method === 'POST') {
        // --- Handle Incoming Messages (POST Request) ---
        // (This part is unchanged)
        console.log('Received incoming message.');
        const body = req.body;
        if (body.object === 'whatsapp_business_account' && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
            const messageData = body.entry[0].changes[0].value.messages[0];
            if (messageData.type === 'text') {
                const from = messageData.from; // The sender's phone number
                const msg_body = messageData.text.body;
                console.log(`Message from ${from}: "${msg_body}"`);
                processMessage(msg_body, from); // Pass the number to the processor
            }
        }
        res.sendStatus(200);
    } else {
        res.sendStatus(405);
    }
});


/**
 * Generates a response using the Gemini AI and sends it back to the user.
 * @param {string} userMessage - The text message from the WhatsApp user.
 * @param {string} from - The user's phone number.
 */
async function processMessage(userMessage, from) {
    try {
        console.log(`Getting AI response for: "${userMessage}" from user ${from}`);
        // Pass the 'from' number to the AI function to get a personalized response
        const aiResponse = await getGeminiResponse(userMessage, from);
        
        if (aiResponse) {
            console.log(`AI Response: "${aiResponse}"`);
            await sendWhatsAppMessage(from, aiResponse);
        } else {
            console.log("No response from AI.");
        }
    } catch (error) {
        console.error("Error processing message:", error.message);
        await sendWhatsAppMessage(from, "Sorry, I encountered an error. Please try again later.");
    }
}

/**
 * Calls the Gemini API to get a text response, personalized for the user.
 * @param {string} prompt - The user's message to send to the AI.
 * @param {string} from - The user's phone number.
 * @returns {Promise<string|null>} - The AI-generated text or null on error.
 */
async function getGeminiResponse(prompt, from) {
    // --- THIS IS THE PERSONALIZATION LOGIC ---

    // 1. Look up the user in our database
    const user = users[from];
    let personalizedPrompt;

    // 2. Create a custom system prompt based on the user
    if (user) {
        // If the user is recognized
        personalizedPrompt = `You are a helpful personalized AI assistant. Since you will be talking to multiple people you should know the constraints of talking to different people. There are currently 2 people whom you will be talking with, Admin and his very close friend. You are currently speaking with ${user.name}, who is ${user.role}. Address them by their name and be extra friendly.`;
    } else {
        // A generic prompt for unknown users
        personalizedPrompt = "You are a friendly and helpful assistant. Keep your answers concise and clear.";
    }
    
    console.log("Using System Prompt:", personalizedPrompt);

    const payload = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        systemInstruction: {
            parts: [{
                text: personalizedPrompt // Use the personalized prompt here!
            }]
        },
    };

    try {
        const response = await axios.post(GEMINI_API_URL, payload);
        const text = response.data.candidates[0].content.parts[0].text;
        return text.trim();
    } catch (error) {
        console.error("Error fetching Gemini response:", error.response ? error.response.data : error.message);
        return "I'm having trouble thinking right now.";
    }
}

/**
 * Sends a text message to a user via the WhatsApp Business API.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The message to send.
 */
async function sendWhatsAppMessage(to, text) {
    // (This function is unchanged)
    const payload = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
            body: text
        },
    };

    const headers = {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
    };

    try {
        console.log(`Sending message to ${to}: "${text}"`);
        await axios.post(WHATSAPP_API_URL, payload, { headers });
        console.log('Message sent successfully!');
    } catch (error) {
        console.error('Error sending WhatsApp message:', error.response ? error.response.data : error.message);
    }
}

// Default route for health check
app.get('/', (req, res) => {
    res.send('WhatsApp AI Agent is running!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

