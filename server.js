import express from 'express';
import OpenAI from 'openai';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

console.log("Iniciando servidor de Adaptive Goaltending...");

// 1. Verificamos que la llave de OpenAI exista
if (!process.env.OPENAI_API_KEY) {
  console.error("⚠️ ALERTA: No se encontró la OPENAI_API_KEY en Render.");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'llave_nula' });

// 2. Leemos tu archivo con seguro anti-accidentes
let SYSTEM_PROMPT = "Eres un coach de lacrosse."; 
try {
  SYSTEM_PROMPT = fs.readFileSync('./conocimiento.txt', 'utf-8');
  console.log("✅ Archivo conocimiento.txt leído correctamente. Cerebro cargado.");
} catch (error) {
  console.error("⚠️ ERROR: No se pudo leer el archivo 'conocimiento.txt'.");
}

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const userToken = req.headers['authorization'];

  if (userToken !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: 'Acceso denegado. Ingresa desde la academia.' });
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Unimos el SYSTEM_PROMPT al inicio del historial de mensajes
    const fullMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(messages || [])
    ];

    const stream = await openai.chat.completions.create({
      model: process.env.MODEL_NAME || 'gpt-4o-mini',
      messages: fullMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const textChunk = chunk.choices[0]?.delta?.content || '';
      if (textChunk) {
        // Mantenemos el mismo formato JSON { text: ... } para tu frontend
        res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
      }
    }
    res.end();
  } catch (error) {
    console.error("Error en conexión:", error);
    res.status(500).json({ error: 'Error interno de conexión.' });
  }
});

const PORT = process.env.PORT || 3000;

// 3. Le decimos explícitamente '0.0.0.0' a Render
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Motor IA Encendido y escuchando puertas en el puerto ${PORT}`);
});
