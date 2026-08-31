# Voz de la personaje

## Arquitectura actual

```text
texto del nodo
  → NpcSpeechService
      1. LocalVoiceProvider
      2. TTSProvider configurado
      3. textOnly
  → SpeechPlaybackEngine
  → XState npcSpeaking
  → CharacterRig
```

`DialogueNode` admite `audioAsset` y `slowAudioAsset`. Los WAV definitivos se
ubicarán en `public/assets/audio/airport/`; el README de esa carpeta lista los
siete nombres previstos. No se agregó ninguna voz inventada o descargada.

Si existe `slowAudioAsset`, `Mais devagar` lo usa. Si sólo existe el asset normal,
la reproducción baja de forma moderada a 0.82×. Si falta o está corrupto, la
frase sigue visible, se registra `speech.npc.assetMissing` o
`speech.voice.unavailable`, se usa texto y la lección continúa.

## Reproducción y boca

`SpeechPlaybackEngine` carga el asset, expone inicio/fin/error y analiza amplitud
mediante `AnalyserNode` aproximadamente 11 veces por segundo. `CharacterRig`
suaviza ese valor y elige boca cerrada, media o abierta. No hay lip-sync
fonético. Al finalizar se cierra la boca y XState habilita la respuesta.

## Frontera TTS

`TTSProvider.synthesize` recibe texto, locale, `voiceId` opcional y rate. La
configuración `airportAgent.voice.ts` fija sólo `pt-BR`, rate y pitch; no inventa
un identificador. Las credenciales y llamadas deben residir en una integración
posterior segura, nunca hardcodeadas en el frontend.

## Estrategia recomendada

Para la primera versión conviene generar y aprobar los siete clips fuera del
runtime, incorporarlos como WAV locales y mantener la aplicación offline. Esto
da voz consistente, cero latencia y ninguna dependencia cloud durante la lección.

Para texto dinámico futuro, el provider permite elegir sin modificar XState ni
`LessonEngine`:

- Azure Custom Voice: alineado con el SDK ya presente, orientado a voces de marca
  y personaje; requiere acceso aprobado, consentimiento y endpoint desplegado.
- OpenAI custom voices: API con muestra y grabación de consentimiento previa;
  el acceso está limitado a clientes elegibles.
- ElevenLabs: clonación instantánea o profesional; útil para prototipar, pero la
  clonación profesional verifica que la voz pertenezca al titular y tiene reglas
  específicas para compartir voces de terceros.

Fuentes oficiales consultadas:

- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-neural-voice
- https://developers.openai.com/api/reference/resources/audio/subresources/voices/methods/create
- https://developers.openai.com/api/reference/resources/audio/subresources/voice_consents/methods/create
- https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning

Antes de integrar se debe decidir quién es titular de la voz, obtener permiso
escrito y grabado, probar portugués brasileño y comparar calidad, latencia, costo,
uso offline y condiciones de distribución. La Parte 4 no envía audio a ninguno.
