import type { StationId } from '../world/kitchen';
import { hm } from './clock';

export type MGKind = 'slice' | 'fill' | 'cook' | 'pick' | 'coat' | 'sort' | 'shuck' | 'swipe' | 'sequence';

export interface TaskDef {
  id: string;
  title: string;
  /** Subtítulo en minúsculas, igual que en el video ("7:10 am · empacando caviar..."). */
  caption: string;
  icon: string;
  station: StationId;
  kind: MGKind;
  params: Record<string, unknown>;
  at: number;
  window: number;
  minDay: number;
  core?: boolean;
  family?: boolean;
  after?: string;
  onlyDay?: number;
}

/** Agenda real del video, en orden. Cada día se arma con un subconjunto creciente. */
export const TASKS: TaskDef[] = [
  { id: 'clockin', title: 'Uniforme y fichar entrada', caption: 'llegando · uniforme y reloj', icon: '🕕', station: 'entrada', kind: 'sequence', params: { kind: 'clockin' }, at: hm(6, 50), window: 25, minDay: 1, core: true },
  { id: 'setup', title: 'Mise en place matutina', caption: 'mise en place de la mañana', icon: '🔪', station: 'prep', kind: 'sequence', params: { kind: 'setup' }, at: hm(7, 5), window: 30, minDay: 1, core: true },
  { id: 'caviar', title: 'Empacar caviar para el servicio', caption: 'empacando caviar para el servicio', icon: '🫙', station: 'frio', kind: 'fill', params: { kind: 'caviar', count: 5 }, at: hm(7, 10), window: 75, minDay: 1, core: true },
  { id: 'fishdel', title: 'Guardar entrega de pescado', caption: 'guardando la entrega de pescado', icon: '📦', station: 'camara', kind: 'sort', params: { kind: 'fish', count: 7 }, at: hm(7, 25), window: 60, minDay: 2 },
  { id: 'pinbone', title: 'Sacar espinas a la trucha', caption: 'sacando espinas a la trucha', icon: '🐟', station: 'prep', kind: 'pick', params: { kind: 'pinbone', rounds: 2 }, at: hm(7, 40), window: 70, minDay: 1, core: true },
  { id: 'cure', title: 'Curar pez espada', caption: 'curando pez espada', icon: '🧂', station: 'prep', kind: 'coat', params: { kind: 'cure', count: 2 }, at: hm(8, 0), window: 50, minDay: 2 },
  { id: 'smoke', title: 'Ahumar pez espada en caliente', caption: 'ahumando pez espada en caliente', icon: '🔥', station: 'ahumador', kind: 'cook', params: { kind: 'smoke', slots: 2, count: 2 }, at: hm(8, 10), window: 60, minDay: 2, after: 'cure' },
  { id: 'langou', title: 'Limpiar langostinos', caption: 'procesando langostinos', icon: '🦐', station: 'prep', kind: 'swipe', params: { kind: 'langoustine', count: 6 }, at: hm(8, 30), window: 60, minDay: 1 },
  { id: 'carrot', title: 'Picar zanahoria para el fondo', caption: 'mirepoix para el fondo de langostino', icon: '🥕', station: 'prep', kind: 'slice', params: { item: 'carrot', count: 2 }, at: hm(9, 0), window: 50, minDay: 1, core: true },
  { id: 'stock', title: 'Fondo de langostino', caption: 'fondo de langostino', icon: '🍲', station: 'estufa', kind: 'sequence', params: { kind: 'stock' }, at: hm(9, 5), window: 55, minDay: 1, after: 'carrot', core: true },
  { id: 'fampot', title: 'Papas para la comida del personal', caption: 'papas para la comida del personal', icon: '🥔', station: 'prep', kind: 'slice', params: { item: 'potato', count: 3 }, at: hm(9, 15), window: 60, minDay: 1, family: true },
  { id: 'famfish', title: 'Porcionar pescado', caption: 'pescado para la comida del personal', icon: '🐠', station: 'prep', kind: 'slice', params: { item: 'whitefish', count: 2 }, at: hm(9, 45), window: 60, minDay: 3, family: true },
  { id: 'season', title: 'Sazonar papas', caption: 'sazonando papas', icon: '🌶️', station: 'prep', kind: 'coat', params: { kind: 'season', count: 1 }, at: hm(10, 0), window: 45, minDay: 2, family: true, after: 'fampot' },
  { id: 'dredge', title: 'Enharinar pescado', caption: 'enharinando pescado', icon: '🌾', station: 'prep', kind: 'coat', params: { kind: 'flour', count: 2 }, at: hm(10, 15), window: 45, minDay: 3, family: true, after: 'famfish' },
  { id: 'oyster', title: 'Abrir ostras', caption: 'abriendo ostras', icon: '🦪', station: 'frio', kind: 'shuck', params: { count: 4 }, at: hm(10, 30), window: 60, minDay: 1, core: true },
  { id: 'fries', title: 'Papas fritas para el personal', caption: 'papas fritas para el personal', icon: '🍟', station: 'freidora', kind: 'cook', params: { kind: 'fries', slots: 2, count: 4 }, at: hm(11, 0), window: 45, minDay: 1, family: true, after: 'fampot' },
  { id: 'salmon', title: 'Porcionar salmón', caption: 'fin del break · porcionando salmón', icon: '🍣', station: 'prep', kind: 'slice', params: { item: 'salmon', count: 2 }, at: hm(12, 30), window: 60, minDay: 2 },
  { id: 'labels', title: 'Etiquetar y guardar', caption: 'etiquetando y guardando', icon: '🏷️', station: 'camara', kind: 'sort', params: { kind: 'label', count: 6 }, at: hm(13, 0), window: 50, minDay: 3 },
  { id: 'scallop', title: 'Limpiar vieiras de Hokkaido', caption: 'limpiando vieiras de hokkaido', icon: '🐚', station: 'frio', kind: 'pick', params: { kind: 'scallop', rounds: 1 }, at: hm(13, 15), window: 60, minDay: 2 },
  { id: 'lobster', title: 'Procesar langostas', caption: 'procesando langostas', icon: '🦞', station: 'estufa', kind: 'cook', params: { kind: 'lobster', slots: 3, count: 4 }, at: hm(14, 0), window: 70, minDay: 1, core: true },
  { id: 'tails', title: 'Separar colas de langosta', caption: 'separando colas de langosta', icon: '🦞', station: 'prep', kind: 'swipe', params: { kind: 'lobstertail', count: 4 }, at: hm(15, 50), window: 50, minDay: 3, after: 'lobster' },
  { id: 'caviardel', title: 'Guardar entrega de caviar', caption: 'guardando la entrega de caviar', icon: '📦', station: 'camara', kind: 'sort', params: { kind: 'caviar', count: 6 }, at: hm(16, 0), window: 45, minDay: 4 },
  { id: 'oyster2', title: 'Abrir más ostras', caption: 'abriendo más ostras', icon: '🦪', station: 'frio', kind: 'shuck', params: { count: 5 }, at: hm(16, 40), window: 50, minDay: 2 },
  { id: 'clams', title: 'Revisar almejas', caption: 'revisando almejas para el servicio', icon: '🐚', station: 'frio', kind: 'pick', params: { kind: 'clams', rounds: 1 }, at: hm(17, 30), window: 40, minDay: 3 },
  { id: 'bag', title: 'Embolsar fondos', caption: 'embolsando fondos', icon: '🛍️', station: 'estufa', kind: 'fill', params: { kind: 'stock', count: 4 }, at: hm(18, 0), window: 45, minDay: 1, after: 'stock' },
  { id: 'breakdown', title: 'Limpieza de la estación', caption: 'breakdown · limpieza', icon: '🧽', station: 'prep', kind: 'coat', params: { kind: 'clean', count: 1 }, at: hm(18, 30), window: 40, minDay: 1, core: true },
  { id: 'recipes', title: 'Copiar recetas', caption: 'copiando recetas', icon: '📄', station: 'oficina', kind: 'sequence', params: { kind: 'recipes' }, at: hm(18, 50), window: 40, minDay: 5, onlyDay: 5 },
  { id: 'goodbye', title: 'Despedidas', caption: 'terminando · despedidas', icon: '🤝', station: 'prep', kind: 'sequence', params: { kind: 'goodbye' }, at: hm(19, 15), window: 40, minDay: 5, onlyDay: 5 },
  { id: 'clockout', title: 'Fichar salida', caption: 'fichando salida', icon: '🕗', station: 'entrada', kind: 'sequence', params: { kind: 'clockout' }, at: hm(20, 0), window: 30, minDay: 1, core: true },
];

export interface EventDef {
  id: string;
  from: number;
  to: number;
  minDay: number;
  chef: string;
  task?: Omit<TaskDef, 'at' | 'minDay' | 'id'> & { id?: string };
}

/** Imprevistos del día: llegan como tickets urgentes con poco margen. */
export const EVENTS: EventDef[] = [
  { id: 'vip', from: hm(11, 30), to: hm(17, 30), minDay: 1, chef: 'Mesa VIP confirmada. Necesito 3 ostras más, ¡ahora!', task: { title: 'URGENTE: ostras para mesa VIP', caption: 'mesa vip · ostras', icon: '⭐', station: 'frio', kind: 'shuck', params: { count: 3 }, window: 30 } },
  { id: 'surprise', from: hm(8, 0), to: hm(15, 0), minDay: 2, chef: 'Llegó otra entrega del proveedor. Guárdala antes de que se caliente.', task: { title: 'URGENTE: entrega sorpresa', caption: 'otra entrega', icon: '🚚', station: 'camara', kind: 'sort', params: { kind: 'fish', count: 5 }, window: 30 } },
  { id: 'spill', from: hm(9, 0), to: hm(17, 0), minDay: 2, chef: '¿Qué es ese desastre en la mesa? Límpialo ya.', task: { title: 'URGENTE: limpiar derrame', caption: 'limpiando un derrame', icon: '⚠️', station: 'prep', kind: 'coat', params: { kind: 'clean', count: 1 }, window: 25 } },
  { id: 'tomato', from: hm(9, 30), to: hm(16, 0), minDay: 3, chef: 'Se acabó el tomate en la línea. Trae latas del almacén.', task: { title: 'URGENTE: traer tomate', caption: 'buscando latas', icon: '🥫', station: 'camara', kind: 'sequence', params: { kind: 'fetch' }, window: 25 } },
  { id: 'carrots2', from: hm(12, 0), to: hm(17, 0), minDay: 4, chef: 'El servicio necesita más mirepoix. Rápido.', task: { title: 'URGENTE: más zanahoria', caption: 'más mirepoix', icon: '🥕', station: 'prep', kind: 'slice', params: { item: 'carrot', count: 1 }, window: 25 } },
];

export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
export const LAST_DAY = 5;
