// Datos del juego: ingredientes disponibles y recetas que pueden pedir los clientes.

const INGREDIENTES = {
  pan:     { nombre: "Pan",     icono: "🍞" },
  carne:   { nombre: "Carne",   icono: "🥩" },
  queso:   { nombre: "Queso",   icono: "🧀" },
  lechuga: { nombre: "Lechuga", icono: "🥬" },
  tomate:  { nombre: "Tomate",  icono: "🍅" },
  huevo:   { nombre: "Huevo",   icono: "🥚" },
  arroz:   { nombre: "Arroz",   icono: "🍚" },
  pescado: { nombre: "Pescado", icono: "🐟" },
  limon:   { nombre: "Limón",   icono: "🍋" },
  cebolla: { nombre: "Cebolla", icono: "🧅" },
};

const RECETAS = [
  { nombre: "Hamburguesa",     icono: "🍔", ingredientes: ["pan", "carne", "queso", "lechuga"], puntos: 100 },
  { nombre: "Sándwich mixto",  icono: "🥪", ingredientes: ["pan", "queso", "tomate"],           puntos: 70 },
  { nombre: "Ensalada",        icono: "🥗", ingredientes: ["lechuga", "tomate", "cebolla"],     puntos: 60 },
  { nombre: "Arroz con huevo", icono: "🍳", ingredientes: ["arroz", "huevo"],                   puntos: 50 },
  { nombre: "Ceviche",         icono: "🍽️", ingredientes: ["pescado", "limon", "cebolla"],     puntos: 120 },
];
