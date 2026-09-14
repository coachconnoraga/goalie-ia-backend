const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const app = express();

// Aumentamos el límite de memoria para que soporte audios y fotos sin bloquearse
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let systemPrompt = "";
try {
  systemPrompt = fs.readFileSync(path.join(__dirname, 'conocimiento.txt'), 'utf8');
} catch (err) {
  console.error("Advertencia: No se encontró el archivo conocimiento.txt.");
}

// 1. RUTA PRINCIPAL DE CHAT E IMÁGENES
app.post('/api/chat', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado." });
  }

  try {
    const userMessages = req.body.messages || [];
    const messages = [{ role: "system", content: systemPrompt }, ...userMessages];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      stream: true,
      max_tokens: 2000, 
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Error en /api/chat:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Error procesando el chat." });
    }
  }
});

// 2. RUTA PARA EL MICRÓFONO (WHISPER AI)
app.post('/api/transcribe', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

  if (token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: "No autorizado." });
  }

  try {
    const audioBase64 = req.body.audio;
    if (!audioBase64) return res.status(400).json({ error: 'No se recibió audio' });

    // Limpiamos el código Base64 para que OpenAI lo pueda leer
    const base64Data = audioBase64.split(',')[1]; 
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Guardamos el audio con extensión genérica compatible con iOS y Android
    const filePath = path.join(__dirname, `temp_audio_${Date.now()}.mp4`);
    fs.writeFileSync(filePath, buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });

    fs.unlinkSync(filePath);
    res.json({ text: transcription.text });

  } catch (error) {
    console.error("Error en la transcripción de audio:", error);
    res.status(500).json({ error: error.message || "Error procesando el audio." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor del AGA Coach corriendo en el puerto ${PORT}`);
});
