# 🍳 Juego de Cocina

Prototipo de un juego de cocina contrarreloj para navegador. Llegan pedidos de clientes, armas cada plato con los ingredientes correctos y lo sirves antes de que se acabe la paciencia del cliente.

## Cómo jugar

1. Abre `index.html` en cualquier navegador moderno (no hace falta instalar nada).
2. Mira los pedidos que aparecen arriba: cada uno muestra la receta y una barra de tiempo.
3. Haz clic en los ingredientes para ponerlos en el plato (el orden no importa).
4. Pulsa **Servir**. Si el plato coincide con algún pedido, ganas puntos (más cuanto antes lo sirvas).
5. Si un pedido se agota, pierdes una vida. Con 0 vidas termina la partida.

Atajos: **Espacio** sirve el plato, **Retroceso** quita el último ingrediente, **Esc** vacía el plato.

## Estructura

```
juego-de-cocina/
├── index.html          # Punto de entrada
├── src/
│   ├── recetas.js      # Ingredientes y recetas (datos del juego)
│   ├── juego.js        # Lógica: pedidos, tiempo, puntaje, vidas
│   └── estilos.css     # Estilos
├── assets/             # Imágenes y sonidos (por ahora se usan emojis)
├── docs/
│   └── diseno.md       # Documento de diseño del juego
└── README.md
```

## Añadir una receta

Edita `src/recetas.js` y agrega un objeto a `RECETAS`:

```js
{ nombre: "Ensalada", icono: "🥗", ingredientes: ["lechuga", "tomate", "queso"], puntos: 80 }
```

Los ingredientes deben existir en `INGREDIENTES`.

## Próximos pasos

Ver la hoja de ruta en [`docs/diseno.md`](docs/diseno.md).
