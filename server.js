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

const sessions = {};
let lastActiveSession = null;

app.post('/api/message', async (req, res) => {
  const { sessionId, message, customerName } = req.body;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { messages: [], customerName: customerName || 'Customer' };
  }

  sessions[sessionId].messages.push({ from: 'customer', text: message, time: new Date() });
  lastActiveSession = sessionId;

  try {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: YOUR_WHATSAPP_NUMBER,
      body: `💬 *${sessions[sessionId].customerName}* says:\n\n${message}\n\n_Just reply to this message to respond_`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Twilio error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/webhook', (req, res) => {
  const incomingMsg = req.body.Body || '';
  const from = req.body.From || '';

  console.log(`Incoming from ${from}: ${incomingMsg}`);

  if (from === YOUR_WHATSAPP_NUMBER && lastActiveSession) {
    const sessionId = lastActiveSession;
    if (sessions[sessionId]) {
      sessions[sessionId].messages.push({ from: 'owner', text: incomingMsg, time: new Date() });
      io.to(sessionId).emit('new_message', { from: 'owner', text: incomingMsg });
      console.log(`Reply sent to session ${sessionId}: ${incomingMsg}`);
    }
  }

  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

app.get('/api/history/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.json(sessions[sessionId] || { messages: [] });
});

io.on('connection', (socket) => {
  socket.on('join_session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Socket joined session: ${sessionId}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
