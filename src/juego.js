// Lógica principal: pedidos, tiempo, puntaje y vidas.

const CONFIG = {
  vidasIniciales: 3,
  maxPedidos: 3,
  tiempoPedido: 30,        // segundos que espera un cliente
  intervaloPedido: 6,      // segundos entre pedidos nuevos
  ticksPorSegundo: 10,
};

const estado = {
  puntos: 0,
  vidas: CONFIG.vidasIniciales,
  pedidos: [],             // { id, receta, restante }
  plato: [],               // claves de INGREDIENTES
  siguientePedido: 0,
  enJuego: false,
  temporizador: null,
  idContador: 0,
};

const $ = (id) => document.getElementById(id);

// ---------- Utilidades ----------

function mismosIngredientes(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

function recetaAleatoria() {
  return RECETAS[Math.floor(Math.random() * RECETAS.length)];
}

function mostrarMensaje(texto, tipo = "") {
  const m = $("mensaje");
  m.textContent = texto;
  m.className = "mensaje " + tipo;
}

// ---------- Acciones ----------

function agregarIngrediente(clave) {
  if (!estado.enJuego) return;
  estado.plato.push(clave);
  dibujarPlato();
}

function quitarUltimo() {
  estado.plato.pop();
  dibujarPlato();
}

function vaciarPlato() {
  estado.plato = [];
  dibujarPlato();
}

function servir() {
  if (!estado.enJuego || estado.plato.length === 0) return;

  // Se atiende el pedido coincidente que tenga menos tiempo restante.
  const coincidentes = estado.pedidos
    .filter((p) => mismosIngredientes(p.receta.ingredientes, estado.plato))
    .sort((a, b) => a.restante - b.restante);

  if (coincidentes.length === 0) {
    mostrarMensaje("Ese plato no coincide con ningún pedido.", "error");
    vaciarPlato();
    return;
  }

  const pedido = coincidentes[0];
  const bono = Math.round((pedido.restante / CONFIG.tiempoPedido) * pedido.receta.puntos * 0.5);
  const ganados = pedido.receta.puntos + bono;
  estado.puntos += ganados;
  estado.pedidos = estado.pedidos.filter((p) => p !== pedido);
  mostrarMensaje(`¡${pedido.receta.nombre} servido! +${ganados} puntos`, "exito");
  vaciarPlato();
  dibujarMarcador();
  dibujarPedidos();
}

function nuevoPedido() {
  estado.pedidos.push({
    id: ++estado.idContador,
    receta: recetaAleatoria(),
    restante: CONFIG.tiempoPedido,
  });
  dibujarPedidos();
}

// ---------- Bucle del juego ----------

function tick() {
  const dt = 1 / CONFIG.ticksPorSegundo;

  estado.pedidos.forEach((p) => (p.restante -= dt));
  const vencidos = estado.pedidos.filter((p) => p.restante <= 0);
  if (vencidos.length > 0) {
    estado.vidas -= vencidos.length;
    estado.pedidos = estado.pedidos.filter((p) => p.restante > 0);
    mostrarMensaje("¡Un cliente se fue sin comer!", "error");
    dibujarMarcador();
  }

  estado.siguientePedido -= dt;
  if (estado.siguientePedido <= 0 && estado.pedidos.length < CONFIG.maxPedidos) {
    nuevoPedido();
    estado.siguientePedido = CONFIG.intervaloPedido;
  }

  actualizarBarras();

  if (estado.vidas <= 0) terminar();
}

function iniciar() {
  clearInterval(estado.temporizador);
  Object.assign(estado, {
    puntos: 0,
    vidas: CONFIG.vidasIniciales,
    pedidos: [],
    plato: [],
    siguientePedido: 0,
    enJuego: true,
  });
  $("fin").classList.add("oculto");
  mostrarMensaje("");
  dibujarTodo();
  estado.temporizador = setInterval(tick, 1000 / CONFIG.ticksPorSegundo);
}

function terminar() {
  estado.enJuego = false;
  clearInterval(estado.temporizador);
  $("puntaje-final").textContent = estado.puntos;
  $("fin").classList.remove("oculto");
}

// ---------- Dibujo ----------

function dibujarMarcador() {
  $("puntos").textContent = estado.puntos;
  $("vidas").textContent = "❤️".repeat(Math.max(estado.vidas, 0)) || "—";
}

function dibujarPedidos() {
  const cont = $("pedidos");
  cont.innerHTML = "";
  if (estado.pedidos.length === 0) {
    cont.innerHTML = '<p class="vacio">Esperando clientes…</p>';
    return;
  }
  estado.pedidos.forEach((p) => {
    const div = document.createElement("div");
    div.className = "pedido";
    div.dataset.id = p.id;
    const ingr = p.receta.ingredientes.map((k) => INGREDIENTES[k].icono).join(" ");
    div.innerHTML = `
      <div class="pedido-icono">${p.receta.icono}</div>
      <div class="pedido-nombre">${p.receta.nombre}</div>
      <div class="pedido-ingr">${ingr}</div>
      <div class="tiempo"><div class="tiempo-barra"></div></div>`;
    cont.appendChild(div);
  });
  actualizarBarras();
}

function actualizarBarras() {
  estado.pedidos.forEach((p) => {
    const barra = document.querySelector(`.pedido[data-id="${p.id}"] .tiempo-barra`);
    if (!barra) return;
    const frac = Math.max(p.restante / CONFIG.tiempoPedido, 0);
    barra.style.width = frac * 100 + "%";
    barra.classList.toggle("urgente", frac < 0.3);
  });
}

function dibujarPlato() {
  const cont = $("plato");
  if (estado.plato.length === 0) {
    cont.innerHTML = '<span class="vacio">Vacío</span>';
    return;
  }
  cont.innerHTML = estado.plato
    .map((k) => `<span class="item" title="${INGREDIENTES[k].nombre}">${INGREDIENTES[k].icono}</span>`)
    .join("");
}

function dibujarIngredientes() {
  const cont = $("ingredientes");
  cont.innerHTML = "";
  Object.entries(INGREDIENTES).forEach(([clave, ing]) => {
    const b = document.createElement("button");
    b.className = "ingrediente";
    b.innerHTML = `<span class="icono">${ing.icono}</span><span>${ing.nombre}</span>`;
    b.addEventListener("click", () => agregarIngrediente(clave));
    cont.appendChild(b);
  });
}

function dibujarTodo() {
  dibujarMarcador();
  dibujarPedidos();
  dibujarPlato();
}

// ---------- Eventos ----------

$("btn-servir").addEventListener("click", servir);
$("btn-vaciar").addEventListener("click", vaciarPlato);
$("btn-reiniciar").addEventListener("click", iniciar);

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); servir(); }
  else if (e.code === "Backspace") { e.preventDefault(); quitarUltimo(); }
  else if (e.code === "Escape") vaciarPlato();
});

dibujarIngredientes();
iniciar();
