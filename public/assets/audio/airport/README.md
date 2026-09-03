# Voz local — agente do aeroporto

Adicione aqui os arquivos WAV definitivos da personagem. Eles não são gerados,
baixados nem versionados automaticamente pela aplicação.

Use o ID da linha definido em
`src/lesson/lessons/airport-arrival/lines.ts` como nome estável:

- `<line-id>.wav` para a versão normal;
- `<line-id>-slow.wav` para a versão lenta opcional.

As rotas são registradas uma única vez no catálogo de linhas, nunca nos
componentes. Enquanto `audioAsset` e `slowAudioAsset` não apontarem para um
arquivo existente, PORTUWANA permanece em modo texto sem interromper a lição.
Use WAV mono ou estéreo comum; a voz da NPC é apenas reproduzida e não se mistura
com a captura do usuário.
