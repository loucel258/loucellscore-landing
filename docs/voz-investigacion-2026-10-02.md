# Agente de voz: investigación y propuesta (2 oct 2026)

## 1. Cómo se construyen hoy los mejores voice bots

**Arquitectura dominante: en cascada.** Voz a texto (STT) → modelo (LLM) → texto a voz (TTS), orquestado en streaming. Los modelos "voz a voz" (OpenAI GPT-Realtime-2, Gemini 3.1 Flash Live) ganan en latencia, pero Claude **no tiene API de voz a voz**: con Claude se usa la cascada, que es además la que permite gobernar cada paso (DLP sobre el texto, auditoría, aprobaciones).

**Latencia objetivo:** por debajo de ~800 ms entre que el cliente termina de hablar y el agente empieza a responder. Las cadenas armadas a mano suelen quedar entre 600 y 1.700 ms; Twilio reporta una mediana menor a 0,5 s con ConversationRelay.

**Las piezas líderes:**
| Pieza | Líder 2026 | Por qué importa |
|---|---|---|
| Voz a texto | Deepgram (Nova-3; **Flux** con detección de turno integrada) | Flux decide cuándo terminaste de hablar por el sentido de la frase, no solo por silencio: −200 a −600 ms y ~30% menos interrupciones falsas |
| Texto a voz | **ElevenLabs** (calidad, emoción, idiomas; Flash v2.5 ~75 ms; v3 conversacional ~280 ms con etiquetas de emoción), **Cartesia** Sonic 3/3.5 (la más rápida, risa y emoción, mejoró español), **Hume** Octave (la más "emocional") | La voz es lo primero que el cliente nota; es la pieza con mayor retorno |
| Orquestación | Gestionado: **Twilio ConversationRelay**, Vapi, Retell. Propio: Pipecat, LiveKit Agents | Por debajo de ~10.000 min/mes conviene gestionado; por encima, propio (60–80% más barato) |

**Lo que hace que no suene robótico** (más allá de la voz):
1. Detección de turno semántica y poder interrumpir al agente (barge-in), sin cortarlo por un "ajá" o una tos.
2. Ritmo de conversación telefónica: ~150–160 palabras por minuto (los defaults de TTS suenan lentos).
3. Frases cortas, una pregunta a la vez, sin listas; números, horas y precios dichos como se hablan ("a las tres y media").
4. Muletillas naturales con medida ("claro", "déjame ver") mientras una herramienta trabaja, en vez de silencio.
5. Tono que se adapta: más pausado y cálido si el cliente está molesto.
6. Manejo de silencio ("¿sigues ahí?") y transferencia en vivo a una persona.
7. En Florida: español latino natural y que entienda cuando el cliente mezcla inglés y español.

## 2. Marco legal (resumen, a confirmar con el abogado de Florida)

- **Decir que es IA** al inicio: lo piden la mayoría de los fiscales estatales, la UE (Art. 50) y Colorado desde 2027. Natural ≠ hacerse pasar por humano.
- **Florida es estado de consentimiento de todas las partes para grabar** (F.S. 934.03): el aviso de grabación/transcripción tiene que ir **antes** de grabar.
- **TCPA**: las voces de IA cuentan como "artificiales" (FCC 2024). Las reglas duras aplican a llamadas **salientes**; un recepcionista que **contesta** llamadas queda en la posición más simple.

## 3. Propuesta para Loucells

**Recomendación: Twilio ConversationRelay + nuestro pipeline como cerebro.**
- Ya usamos Twilio (números, credenciales por cliente, opt-out, 10DLC).
- ConversationRelay trae Deepgram Flux (turnos) y voces de ElevenLabs incluidas, con mediana < 0,5 s, y deja **traer nuestro propio modelo**: Claude sigue pasando por DLP, presupuesto, aprobaciones, confirmación en dos pasos, escalación y auditoría encadenada. Ninguna plataforma intermedia guarda las llamadas.
- Lo que hay que agregar: un servicio pequeño siempre encendido para el WebSocket de la llamada (Vercel no mantiene WebSockets abiertos; Fly.io o Railway, ~US$5–10/mes), que por cada turno llama a nuestra API.

**Alternativa más rápida para un piloto:** Vapi o Retell con "custom LLM" apuntando a nuestra API (sin servidor propio, más caro por minuto).

**Qué construimos:**
1. Webhook de llamada entrante → ConversationRelay con saludo que dice que es un asistente y avisa la grabación.
2. Gateway de voz (WebSocket) + endpoint por turno con streaming; canal `voice` en el pipeline (estilo hablado, números hablados, idioma detectado).
3. Confirmación hablada de citas (misma regla de dos pasos), transferencia en vivo al dueño como escalación, mensaje de seguridad ante emergencias.
4. Portal: llamadas en la bandeja (transcripción, duración, resultado) y métricas (llamadas atendidas, fuera de horario, citas por llamada).
5. Pruebas con llamadas simuladas antes de prender a un cliente.

**Lo que necesita Steven:** elegir plataforma (recomendada arriba), crear la cuenta del hosting del gateway, elegir voces (EN y ES) escuchando muestras, y confirmar con el abogado el texto del aviso de grabación.

## Fuentes
- https://telnyx.com/resources/voice-ai-agents-compared-latency
- https://gradium.ai/content/turn-llm-into-voice-agent-best-stack-2026
- https://www.retellai.com/blog/best-speech-to-text-models
- https://elevenlabs.io/docs/overview/models
- https://inworld.ai/resources/elevenlabs-v3-review
- https://www.twilio.com/en-us/products/conversational-ai/conversationrelay
- https://www.twilio.com/en-us/changelog/conversation-relay-now-supports-deepgram-flux---new-features
- https://www.twilio.com/en-us/changelog/elevenlabs-voices-available-for-conversation-relay-public-beta
- https://invideo.io/blog/cartesia-sonic-ai-voice/
- https://www.coval.ai/blog/best-text-to-speech-providers-in-2026-how-to-choose-(and-why-vendor-benchmarks-lie)/
- https://inworld.ai/resources/vapi-vs-pipecat-vs-livekit
- https://hamming.ai/resources/voice-agent-interruption-handling-runbook
- https://ciela.ai/blogs/how-to-make-vapi-sound-more-human
- https://fornarolegal.com/florida-call-recording-law-guide/
- https://www.retellai.com/blog/tcpa-compliance-playbook-voice-ai-outbound
- https://claudexia.tech/blog/claude-voice-realtime-stack-2026
