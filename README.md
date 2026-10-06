# 🔪 Mise en Place NYC

Un día en la vida de un cocinero en un restaurante con estrella Michelin en Nueva York. Llegas a las 6:40 am, te pones la chaqueta, fichas y trabajas la lista de prep: caviar, trucha, pez espada ahumado, langostinos, fondo, la comida del personal, ostras, langostas, almejas y la limpieza final. Hay imprevistos, el chef te califica y a las 8:00 pm fichas la salida.

Es un juego 3D para el navegador, hecho para correr fluido en el celular y en la compu. No descarga ni una imagen ni un sonido: todo se genera al vuelo.

## Jugar

```bash
npm install
npm run dev        # http://localhost:5173
```

Build de producción (sale en `dist/` y se puede servir como sitio estático):

```bash
npm run build
npm run preview
```

### Controles

| Acción | Cómo |
|---|---|
| Elegir tarea | Toca un ticket de la **lista de prep** |
| Cortar | Toca o haz clic sobre la línea guía |
| Servir o hacer palanca | Mantén presionado y suelta |
| Cubrir o limpiar | Arrastra |
| Separar | Desliza a lo largo de la línea |
| Clasificar | Desliza, usa ← ↑ → o toca el destino |
| Pausa | `Esc` o el botón ❚❚ |

Parámetros de URL: `?webgl` fuerza WebGL2 (por defecto se usa WebGPU si está disponible).

## Tecnología

- **Three.js r186 + WebGPURenderer**, con fallback automático a WebGL2
- **TypeScript 7** y **Vite 8**
- Geometría, texturas (canvas) y audio (Web Audio API) 100% procedurales
- Escena estática fusionada por material, instancing para latas y partículas, y resolución dinámica según el tiempo de frame
- UI en HTML/CSS por encima del canvas, pensada primero para celular en vertical
- PWA básica (manifest e ícono)

## Estructura

```
src/
├── main.ts              # Arranque, pantallas (título, pausa, resumen)
├── core/
│   ├── engine.ts        # Renderer, cámara POV, input, resolución dinámica
│   ├── audio.ts         # Sonido procedural
│   └── tween.ts         # Animaciones y utilidades
├── world/
│   ├── kitchen.ts       # La cocina 3D y sus estaciones
│   ├── cook.ts          # Cocineros y chef animados
│   ├── props.ts         # Ingredientes y utensilios
│   ├── materials.ts     # Materiales compartidos
│   ├── textures.ts      # Texturas procedurales
│   └── fx.ts            # Partículas (vapor, fuego, harina…)
├── minigames/           # slice, fill, cook, pick, coat, sort, shuck, swipe, sequence
├── game/
│   ├── tasks.ts         # Agenda del día e imprevistos (sacados del video)
│   ├── director.ts      # Reloj, tickets, cortes de tiempo, nota del chef
│   ├── clock.ts
│   └── save.ts          # Progreso en localStorage
└── ui/                  # HUD, lista de prep, toasts y estilos
```

El diseño completo y el análisis del video están en [`docs/diseno.md`](docs/diseno.md).

## Añadir una tarea

Agrega una entrada a `TASKS` en `src/game/tasks.ts`:

```ts
{ id: 'mise2', title: 'Picar más zanahoria', caption: 'más mirepoix', icon: '🥕',
  station: 'prep', kind: 'slice', params: { item: 'carrot', count: 2 },
  at: hm(15, 0), window: 40, minDay: 2 }
```

`kind` es uno de los 9 minijuegos y `params` ajusta su contenido (qué ingrediente, cuántos, etc.).
