# Airport assets

Los assets activos de la prueba visual se detectan en estas rutas:

```text
background.webp
ambient/background-state-b-v1.png
ambient/background-state-c-v1.png
ambient/background-state-d-v1.png
ambient/background-state-e-v1.png
ambient/background-state-f-v1.png
ambient/ambient-traveler-man-v2.png
ambient/ambient-traveler-woman-v2.png
character/agent-master-v2.png
character/eyes-closed-v2.png
character/mouth-mid-v2.png
character/mouth-open-v2.png
character/expression-smile-v2.png
character/expression-serious-v2.png
character/expression-confused-v2.png
character/expression-surprised-v2.png
```

Los pasajeros v1 con cuadrícula pintada fueron rechazados. Los estados de fondo
B/C/D/E/F usan `-v1` porque son la primera versión aprobada de ese tipo de asset. La
boca cerrada del master, `mouth-mid-v2.png` y `mouth-open-v2.png` forman el
conjunto de habla aprobado. Consultar
`docs/ASSETS_AIRPORT.md` para el contrato visual y
`docs/CHARACTER_ASSET_METHOD.md` para el método reproducible, sus coordenadas y
el registro de iteraciones. La ambientación independiente del fondo está
documentada en `docs/AMBIENT_SCENE_METHOD.md`.
