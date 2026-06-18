import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

console.log("Iniciando servidor de Adaptive Goaltending...");

// 1. Verificamos que la llave exista para que no explote en silencio
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("⚠️ ALERTA: No se encontró la ANTHROPIC_API_KEY en Render.");
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'llave_nula' });

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

    const stream = await anthropic.messages.create({
      max_tokens: 1024,
      messages: messages,
      model: 'claude-3-5-sonnet-20240620',
      system: SYSTEM_PROMPT,
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.end();
  } catch (error) {
    console.error("Error en conexión:", error);
    res.status(500).json({ error: 'Error interno de conexión.' });
  }
});

const PORT = process.env.PORT || 3000;

// 3. LA SOLUCIÓN DEL PUERTO: Le decimos explícitamente '0.0.0.0' a Render
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Motor IA Encendido y escuchando puertas en el puerto ${PORT}`);
});
