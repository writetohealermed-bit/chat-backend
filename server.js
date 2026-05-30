const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const ACCOUNT_SID = 'ACf793bbd51b76280f79af0033d7181095';
const AUTH_TOKEN = 'eb40349eb0a6a95354a197744688e7ff';
const TWILIO_WHATSAPP_NUMBER = 'whatsapp:+14155238886';
const YOUR_WHATSAPP_NUMBER = 'whatsapp:+923034515151';

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

// sessions[sessionId] = { customerName, messages[] }
const sessions = {};
// nameToSession[lowercase_name] = sessionId  — for routing your replies
const nameToSession = {};

// ── Register or resume a session ──────────────────────────────────────────
app.post('/api/session', (req, res) => {
  const { sessionId, customerName } = req.body;
  if (!sessions[sessionId]) {
    sessions[sessionId] = { customerName, messages: [] };
    nameToSession[customerName.trim().toLowerCase()] = sessionId;
    console.log(`New session: ${sessionId} for ${customerName}`);
  }
  res.json({ success: true, messages: sessions[sessionId].messages });
});

// ── Customer sends a text message ─────────────────────────────────────────
app.post('/api/message', async (req, res) => {
  const { sessionId, message, customerName } = req.body;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { customerName, messages: [] };
    nameToSession[customerName.trim().toLowerCase()] = sessionId;
  }

  sessions[sessionId].messages.push({ from: 'customer', text: message, time: new Date() });
  console.log(`Message from ${customerName}: ${message}`);

  try {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: YOUR_WHATSAPP_NUMBER,
      body: `💬 *${customerName}*:\n${message}\n\n_To reply type: ${customerName}: your reply_`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Twilio error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Your WhatsApp reply → customer widget ──────────────────────────────────
// You type:  Saad: Hi, how can I help?
// The name before : must match the customer's name exactly
app.post('/webhook', (req, res) => {
  const incomingMsg = (req.body.Body || '').trim();
  const from = req.body.From || '';

  console.log(`Webhook from ${from}: ${incomingMsg}`);

  if (from === YOUR_WHATSAPP_NUMBER && incomingMsg.includes(':')) {
    const colonIndex = incomingMsg.indexOf(':');
    const namePart = incomingMsg.substring(0, colonIndex).trim().toLowerCase();
    const reply = incomingMsg.substring(colonIndex + 1).trim();

    if (!reply) {
      console.log('Empty reply, skipping');
    } else {
      const sessionId = nameToSession[namePart];
      if (sessionId && sessions[sessionId]) {
        sessions[sessionId].messages.push({ from: 'owner', text: reply, time: new Date() });
        io.to(sessionId).emit('new_message', { from: 'owner', text: reply });
        console.log(`✅ Reply to ${namePart} (${sessionId}): ${reply}`);
      } else {
        console.log(`❌ No session for name: "${namePart}". Known names: ${Object.keys(nameToSession).join(', ')}`);
      }
    }
  }

  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ── Get chat history ───────────────────────────────────────────────────────
app.get('/api/history/:sessionId', (req, res) => {
  const s = sessions[req.params.sessionId];
  res.json(s ? { messages: s.messages } : { messages: [] });
});

// ── Socket.io ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket joined: ${sessionId}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
