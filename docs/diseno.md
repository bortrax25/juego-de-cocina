# Documento de diseño — Juego de Cocina

## Concepto

Juego de gestión de tiempo: el jugador atiende pedidos de clientes combinando ingredientes antes de que se agote su paciencia.

## Bucle principal

1. Aparece un pedido (máximo 3 a la vez) con un temporizador.
2. El jugador elige ingredientes y los coloca en el plato.
3. Sirve: si coincide con un pedido, gana puntos base + bono por rapidez.
4. Si un pedido vence, pierde una vida. Con 0 vidas termina el turno.

## Parámetros (en `src/juego.js` → `CONFIG`)

| Parámetro          | Valor | Efecto                            |
|--------------------|-------|-----------------------------------|
| `vidasIniciales`   | 3     | Errores permitidos                |
| `maxPedidos`       | 3     | Pedidos simultáneos               |
| `tiempoPedido`     | 30 s  | Paciencia de cada cliente         |
| `intervaloPedido`  | 6 s   | Frecuencia de nuevos pedidos      |

## Hoja de ruta

- [x] Prototipo jugable: pedidos, plato, puntaje, vidas
- [ ] Dificultad progresiva (menos tiempo, más pedidos)
- [ ] Preparación de ingredientes (cortar, cocinar, freír)
- [ ] Niveles con recetas desbloqueables
- [ ] Sonidos y arte propio en `assets/`
- [ ] Guardar récord (mejor puntaje)
- [ ] Versión para móvil (arrastrar y soltar)
