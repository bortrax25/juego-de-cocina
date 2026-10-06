# Documento de diseño — Mise en Place NYC

## Concepto

Simulador de un día de trabajo de un cocinero de producción (prep cook) en un restaurante con estrella Michelin en Nueva York. Es para jugar sin pensar demasiado y meterse en esa vida: llegar de madrugada, ponerse el uniforme, sacar tickets de la lista de prep, recibir entregas, abrir ostras, aguantar al chef y fichar la salida de noche.

Hay poca narrativa a propósito. Lo que manda es el ritmo: tareas cortas y táctiles, una tras otra, con el reloj siempre corriendo.

## Lo que tomamos del video de referencia

El video ("Last day working in a Michelin starred kitchen") cuenta un turno completo con cortes de edición y subtítulos pequeños en el centro ("7:10 am · packing caviar for service"). Lo analizamos cuadro por cuadro (cada 2 s) y de ahí salieron la agenda, la estética y las mecánicas del juego:

| Hora en el video | Lo que pasa | En el juego |
|---|---|---|
| 6:40 am | Llegada por la calle | Pantalla de inicio del día |
| 6:50 am | Locker, chaqueta, escaleras, reloj checador | `clockin`: chaqueta → delantal → fichar |
| 7:05 am | Morning setup: cuchillos sobre bandeja y trapo | `setup` (secuencia) |
| 7:10 am | Empacar caviar para el servicio | `fill`: mantener para porcionar |
| 7:25 am | Guardar la entrega de pescado | `sort`: cámara / congelador / seco |
| 7:40 am | Sacar espinas a la trucha | `pick`: pinzas |
| 8:00–8:10 am | Curar y ahumar pez espada (llamas) | `coat` + `cook` (llamaradas) |
| 8:30–9:00 am | Langostinos y fondo, zanahoria, latas del almacén | `swipe`, `slice`, `sequence` en orden |
| 9:15–11:00 am | Comida del personal: papas, pescado, enharinado, fritas | `slice`, `coat`, `cook` (freidora) |
| 10:30 am | Abrir ostras | `shuck`: palanca + corte |
| ~11:30 am | "Pastry team approved" | Evento si la comida del personal sale bien |
| 12:30–1:15 pm | Salmón, etiquetas con cinta, vieiras de Hokkaido | `slice`, `sort`, `pick` |
| 2:00–4:00 pm | Langostas, colas, entrega de caviar | `cook`, `swipe`, `sort` |
| 4:40–5:30 pm | Más ostras, almejas | `shuck`, `pick` |
| 6:00–7:15 pm | Embolsar fondos, breakdown, copiar recetas, regalo, despedidas | `fill`, `coat` (limpiar), `sequence` |
| 8:00 pm | Fichar salida, lista de horarios | Resumen con hoja de horarios |

Estética que copiamos: cámara POV de celular con leve movimiento de mano, acero inoxidable, azulejo blanco tipo metro, luz fluorescente fría, chaquetas blancas con delantal azul marino, tablas de picar beige, cinta de pintor verde para las etiquetas y la lata de caviar azul con banda roja.

Por respeto a las personas que salen en el video, las capturas que usamos para analizarlo no se guardan en el repositorio.

## Bucle principal

1. El reloj corre a **1 minuto de juego por segundo**.
2. Cada tarea aparece como ticket en la **lista de prep** a su hora, con una hora límite.
3. Tocas un ticket: la cámara "camina" hasta la estación y empieza el minijuego.
4. El resultado (precisión y velocidad) da un % de calidad y mueve la **nota del chef**.
5. Si no queda nada pendiente, el juego hace un **corte de edición** hasta el siguiente ticket, igual que el video.
6. Los **imprevistos** (mesa VIP, entrega sorpresa, derrame, falta de tomate) entran como tickets urgentes con poco margen.
7. A las 8:00 pm fichas la salida y ves el resumen del turno con tus estrellas (0–3).

## Mecánicas (9 tipos de minijuego, `src/minigames/`)

| Tipo | Gesto | Se usa en |
|---|---|---|
| `slice` | Tocar sobre la guía. La mano en garra protege el producto y, si cortas sobre ella, te cortas | zanahoria, papas, salmón, pescado |
| `fill` | Mantener presionado (el chorro acelera) y soltar dentro de la franja | caviar, embolsar fondos |
| `cook` | Varias canastas u ollas a la vez: tocar para meter y sacar en el punto. A veces el aceite o la llama se disparan | papas fritas, langostas, ahumado |
| `pick` | Pinzas de precisión: tocar lo correcto sin dañar el producto | espinas de trucha, vieiras, almejas |
| `coat` | Arrastrar para cubrir o limpiar (pintura sobre la textura) | cura, harina, sazón, breakdown |
| `sort` | Deslizar, usar las flechas o tocar el destino | entregas de pescado y caviar, etiquetas |
| `shuck` | Mantener la presión dentro de una franja que se mueve y luego deslizar | ostras |
| `swipe` | Deslizar a lo largo de la línea de corte | langostinos, colas de langosta |
| `sequence` | Tocar en orden o tocar todos | fichar, setup, fondo, recetas, despedidas |

## Progresión

- 5 días (lunes a viernes). Cada día suma tareas (9 + 2×día), imprevistos y plazos más cortos.
- Con 1 estrella o más se desbloquea el día siguiente.
- El día 5 es el **último día**: copiar recetas, despedirse del equipo, el regalo (pan de masa madre) y la foto grupal final.

## Técnica

- **Three.js r186 con `WebGPURenderer`**. Si el navegador no tiene WebGPU, o falla, pasa solo a WebGL2 (recarga una vez).
- **Cero assets descargables**: geometría, texturas (canvas) y audio (Web Audio) se generan en el momento. Se carga al instante.
- La geometría estática se fusiona por material, así toda la cocina se dibuja en unos ~25 draw calls. Las latas van instanciadas y las partículas son *billboards* instanciados en un pool, sin generar basura por frame.
- **Resolución dinámica**: si el frame pasa de ~20 ms baja el *pixel ratio*, y lo sube cuando sobra margen.
- La UI es HTML/CSS encima del canvas y solo se toca el DOM cuando algo cambia.
- Pensado para celular en vertical: la cámara se aleja según el aspecto de pantalla y la lista de prep pasa a ser una barra inferior.

## Parámetros útiles

| Dónde | Qué |
|---|---|
| `src/game/tasks.ts` → `TASKS` | Agenda del día: hora, ventana, estación, minijuego y parámetros |
| `src/game/tasks.ts` → `EVENTS` | Imprevistos y su rango horario |
| `src/game/director.ts` → `rate` | Velocidad del reloj (min de juego por segundo) |
| `src/world/kitchen.ts` → `STATIONS` | Posición y cámara de cada estación |

## Hoja de ruta

- [x] Cocina 3D completa con estaciones y equipo animado
- [x] 9 mecánicas y 27 tareas sacadas del video
- [x] Imprevistos, nota del chef, estrellas y progreso guardado
- [x] Último día con despedidas y foto grupal
- [ ] Post-proceso opcional (bloom en llamas) para equipos potentes
- [ ] Modo servicio nocturno (línea caliente con tickets de comensales)
- [ ] Más variedad de días (eventos especiales, inspector Michelin)
